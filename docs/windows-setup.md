# Windows 設定與安裝（WIN-01）

適用 Windows 原生部署（規格見 [Windows 原生部署規格](windows-native-deployment.md)）。本文件涵蓋 WIN-01：前置檢查、受保護設定檔、與網站／CLI／排程一致的設定載入，以及原生 install／lint／typecheck／build；以及 WIN-02：正式本機頭像目錄（第 7 節）。Windows 服務（WIN-03）、受邀讀取（WIN-04）與排程備份（WIN-05）另見各任務。

> 狀態：以下指令已在 GitHub Actions 的 Windows Server 執行器（`windows-2025`，Node 24.11.1、npm 10.9.4、執行器內建 PostgreSQL）自動執行，結果見 [驗收報告](acceptance-report.md)。**尚未在你的 Windows 11 主機執行**；請依序執行並回報每一步的輸出與 `exit=` 值。

## 設定載入規則

網站（`npm run dev`／`npm start`）、CLI（`db:migrate`、`db:bootstrap`、`jobs:run`、`db:seed-dev`、`config:check`）與之後的排程都使用同一個載入器 `scripts/config/load-config.mjs`，在任何程式讀取環境變數之前載入：

1. **`CHAINSEABASE_CONFIG_FILE`** 指向的設定檔（`KEY=VALUE`，放在儲存庫外、受 NTFS ACL 保護）。staging／production **只**接受此來源。
2. development 且沒有設定檔時，讀取應用目錄的 `.env.local`（與 `next dev` 相同），讓 CLI 與網站看到相同值。
3. 程序環境變數：只有與檔案相同值時才允許；development 也可提供檔案未設定的變數。

一律拒絕、不會默默挑一個：

| 情況 | 結果 |
| --- | --- |
| 同一變數在程序環境與設定檔的值不同 | 拒絕 |
| staging／production 的變數只出現在程序環境（例如開著的 PowerShell 視窗的 `$env:`） | 拒絕 |
| 使用設定檔時，應用目錄仍有 `.env`、`.env.local`、`.env.production` 等檔案（Next.js 會自行合併，形成第二個來源） | 拒絕 |
| 連線字串內含密碼，且與 `PGPASSWORD` 不同 | 拒絕（已驗證的本機做法是：URL 不含密碼＋`PGPASSWORD`） |
| 設定檔有未知變數（拼字錯誤）、重複變數或不是 `KEY=VALUE` 的行 | 拒絕 |
| staging／production 沒有明確的 `DATABASE_URL`、`ADMIN_ORIGIN`、`PORTAL_ORIGIN` | 拒絕（不退回本機預設） |

拒絕時結束代碼為 **78**，訊息只列變數名稱、檔名與行號，不顯示任何值。設定檔用 UTF-8（有無 BOM 皆可）、CRLF 或 LF 皆可；值可用成對的 `"` 或 `'` 包住；不支援行尾註解（秘密可能含 `#`）。

## 0. 開啟 PowerShell

以「系統管理員」身分開啟 PowerShell，切到應用目錄（例：`Set-Location C:\Apps\Chainseabase`）。指令逐行執行；每個指令後的 `echo "exit=$LASTEXITCODE"` 必須是 `exit=0` 才繼續。**不要**把 Bash 的 `VAR=value command` 寫法貼進 PowerShell。若執行原則阻擋腳本，只對單一指令放寬：`powershell -NoProfile -ExecutionPolicy Bypass -File <腳本>`。

## 1. 前置檢查

```powershell
.\scripts\windows\Test-ChainseabasePrerequisites.ps1 -RequireAdmin
echo "exit=$LASTEXITCODE"
```

檢查 Windows 版本、系統管理員權限、Node.js（需 ≥ 22.12.0）、npm、Git、psql、PostgreSQL Windows 服務（執行中且「自動」啟動）、PostgreSQL 埠是否只監聽 `127.0.0.1`／`::1`，以及接電時的睡眠設定。`FAIL` 會讓結束代碼為 1。若 5432 監聽外部位址：在 `postgresql.conf` 設定 `listen_addresses = 'localhost'` 後重新啟動 PostgreSQL 服務；不要以防火牆或路由器轉送代替。

記錄輸出中的實際版本（目前回報：Node 24.11.1、npm 10.9.4 用於 `npm ci`、PostgreSQL 18.6）。

## 2. 建立受保護的設定檔

把現有 `.env.local` 匯入新的設定檔（原檔不刪除），並把設定檔路徑存成電腦層級變數，讓之後的服務與排程不依賴開著的 PowerShell：

```powershell
.\scripts\windows\New-ChainseabaseConfig.ps1 -ImportEnvFile .\.env.local -SetMachineVariable
echo "exit=$LASTEXITCODE"
```

- 預設位置：`C:\ProgramData\Chainseabase\config\chainseabase.env`。目錄與檔案取消繼承，只允許 SYSTEM 與 Administrators（以 SID 設定，中文 Windows 也正確）；之後 WIN-03 建立服務帳號時再以 `-ServiceAccount` 加上唯讀權限。
- 只有在缺少時才產生 `AUTH_SESSION_SECRET` 與 `TOKEN_ENCRYPTION_KEY`；已有的值永遠不覆寫（重產會讓所有人登出、已存的日曆授權無法解密）。請把這兩個值另存到你的秘密備份（WIN-05 會處理備份流程）。
- 設定檔已存在時，再次執行不會改動內容，`-ImportEnvFile` 會被忽略。

接著把 `.env.local` 移出應用目錄（保留作備份，放到受保護的設定目錄）：

```powershell
Move-Item -LiteralPath .\.env.local -Destination "$env:ProgramData\Chainseabase\config\env-local.backup"
echo "exit=$LASTEXITCODE"
```

**關閉並重新開啟**系統管理員 PowerShell，讓電腦層級的 `CHAINSEABASE_CONFIG_FILE` 生效：

```powershell
[Environment]::GetEnvironmentVariable('CHAINSEABASE_CONFIG_FILE', 'Machine')
$env:CHAINSEABASE_CONFIG_FILE
```

兩行都應顯示設定檔路徑。

## 3. 設定或輪替單一值

密碼與金鑰用安全輸入（不回顯、不進入 PowerShell 歷史）：

```powershell
.\scripts\windows\Set-ChainseabaseConfigValue.ps1 -Name PGPASSWORD
echo "exit=$LASTEXITCODE"
```

常用：`PGPASSWORD`、`GOOGLE_CLIENT_SECRET`、`RESEND_API_KEY`、`BOOTSTRAP_TEAM_EMAIL`。資料庫連線維持已驗證的做法：`DATABASE_URL` 不含密碼（例 `postgresql://chainseabase_dev@127.0.0.1:5432/chainseabase_dev`），密碼只放 `PGPASSWORD`。移除變數：加上 `-Remove`。輪替秘密後需重新啟動網站與排程（WIN-03／05）。

本機同機 PostgreSQL（`127.0.0.1`）不需要 `sslmode`；舊 Supabase 連線另依 [staging 文件](staging-setup.md) 使用 `sslmode=verify-full`。不要以全域停用 TLS 驗證處理任何連線問題。

## 4. 驗證設定

```powershell
.\scripts\windows\Test-ChainseabaseConfig.ps1
echo "exit=$LASTEXITCODE"
```

- NTFS：目錄與檔案不得繼承權限，只能授權給 SYSTEM、Administrators 及 `-AllowedReader` 指定的帳號；例如 `BUILTIN\Users` 可讀會判定失敗。
- 接著以相同載入器執行 `npm run config:check`：列出每個變數的來源（`config file`／`process`／`not set`）與 provider 模式，不顯示值；最後執行應用自身的設定驗證。
- 應用目錄預設為腳本所在位置往上兩層；無法取得腳本位置時改用目前目錄。該目錄必須含 `package.json` 與 `scripts\config\load-config.mjs`，否則顯示 `FAIL not the Chainseabase app directory` 並結束代碼 1；此時加上 `-AppDirectory C:\Apps\Chainseabase`（你的應用目錄）。

## 5. 資料庫與建置

```powershell
npm ci
echo "exit=$LASTEXITCODE"
npm run db:migrate
echo "exit=$LASTEXITCODE"
npm run db:migrate
echo "exit=$LASTEXITCODE"
npm run db:bootstrap
echo "exit=$LASTEXITCODE"
npm run lint
echo "exit=$LASTEXITCODE"
npm run typecheck
echo "exit=$LASTEXITCODE"
npm run build
echo "exit=$LASTEXITCODE"
```

預期：

- `npm ci`：若主機的 npm 是 11.x，依先前做法以 10.9.4 執行（`npx --yes npm@10.9.4 ci`），並記錄實際使用的版本。
- `db:migrate`：先顯示 `Migrating <主機>:<埠>/<資料庫>`；第二次為 `Database schema is up to date.`。
- `db:bootstrap`：重跑顯示 `product already present`；首位團隊資格已使用過時顯示 `skipped_team_exists`。
- migration 檢查碼不受換行符號影響：同一個 migration 在 Windows（CRLF）與其他環境（LF）簽出都視為未修改；真正的內容變更仍會被拒絕。

## 6. 啟動（僅本機開發）

```powershell
npm start
```

`npm start` 透過同一個載入器啟動 `next start`，只監聽 `127.0.0.1:3000`（`npm run dev` 相同），區網其他電腦無法連線。後台 <http://localhost:3000>、前台 <http://127.0.0.1:3000>，與 `ADMIN_ORIGIN`／`PORTAL_ORIGIN` 及 Google callback 一致。WIN-02（正式頭像）已完成、WIN-04（受邀讀取）已實作，但在 WIN-03 服務與 WIN-06 Tunnel 完成並取得授權前，仍只供本機使用，**不得**經 Tunnel 或路由器對外開放；Windows 服務化、開機自動恢復與日誌在 WIN-03 處理，不以開著的 PowerShell 視窗代替。

## 7. 頭像儲存（WIN-02）

正式頭像使用 `STORAGE_PROVIDER=filesystem`，檔案放在應用目錄**以外**的固定目錄（預設 `C:\ProgramData\Chainseabase\data\avatars`），升級或重新簽出程式不會刪除頭像。檔案只經 `/api/v1/avatars/<使用者>` 讀取，不作為靜態檔案提供。舊的 `.data\avatars`（開發用 fake 替身）只作為匯入來源，不刪除。

在應用目錄、系統管理員 PowerShell：

```powershell
.\scripts\windows\Initialize-ChainseabaseAvatarStorage.ps1 -ImportFrom .\.data\avatars
echo "exit=$LASTEXITCODE"
.\scripts\windows\Test-ChainseabaseConfig.ps1
echo "exit=$LASTEXITCODE"
```

- 建立頭像目錄並取消繼承權限：SYSTEM、Administrators 完全控制；WIN-03 建立服務帳號後以 `-ServiceAccount` 再執行一次，授予該帳號「修改」權限。
- `-ImportFrom` 只複製符合應用物件名稱（`<使用者 id>\<16 字元>.webp`）的檔案，既有目的檔不覆寫、來源不刪除；資料庫中的頭像路徑不變。若 `.data\avatars` 不存在，省略 `-ImportFrom`。
- 在設定檔寫入 `STORAGE_PROVIDER=filesystem` 與 `AVATAR_STORAGE_DIR`。設定檔已有不同的 `AVATAR_STORAGE_DIR` 時拒絕（exit 1），避免改指向後舊頭像全部遺失。
- 拒絕應用目錄內的路徑、UNC 網路路徑與 `\\?\`／`\\.\` 裝置路徑；應用程式啟動時以相同規則再檢查一次。
- `Test-ChainseabaseConfig.ps1` 另檢查頭像目錄的 NTFS ACL；`config:check` 顯示 `storage=real (filesystem)`，並以目前帳號寫入／刪除一個暫存檔確認可寫入。

重新啟動網站（`npm start`）後上傳一張頭像、重新整理頁面，再停止並重新啟動網站，確認頭像仍在；檔案應出現在頭像目錄的 `<使用者 id>` 子目錄下，應用目錄內不應出現新的 `.data\avatars` 檔案。

## 8. 受邀讀取（WIN-04）本機驗證

前台（`http://127.0.0.1:3000`）與後台（`http://localhost:3000`）的公司內容只提供給已登入且受邀的成員：未登入 API 回 401，未受邀、已移除或沒有該產品資格的帳號回 404（與不存在相同）。頭像也需登入並每次重新驗證，不由共用快取保存。

```powershell
git pull origin claude/keen-lamport-4qb974
npm ci;            echo "exit=$LASTEXITCODE"
npm run build;     echo "exit=$LASTEXITCODE"
npm start
```

另開一個 PowerShell（不需系統管理員），檢查未登入的 API（PowerShell 5.1／7 皆可）：

```powershell
foreach ($p in '/api/v1/public/products', '/api/v1/public/products/product-1/feedback', '/api/v1/public/products/product-1/feedback?q=a') {
  try { Invoke-WebRequest "http://127.0.0.1:3000$p" -UseBasicParsing | Out-Null; "$p -> 200 (不應發生)" }
  catch { "$p -> $([int]$_.Exception.Response.StatusCode)" }
}
```

預期三行都是 `-> 401`（若產品網址代稱不是 `product-1`，改用前台首頁連結中的代稱）。

瀏覽器：

1. **無痕視窗**開 `http://127.0.0.1:3000/` 與 `http://127.0.0.1:3000/p/product-1/feedback`：只顯示「請先登入」，看不到產品名稱或任何回饋標題。
2. 一般視窗以團隊帳號登入前台：可看到所有產品的回饋、Roadmap 與自己的頭像；後台功能不變。
3. 在已登入頁面的頭像上按右鍵「複製圖片網址」，貼到無痕視窗：應顯示錯誤（未登入），不是圖片。開發人員工具 → Network → 該頭像的回應標頭應有 `cache-control: private, no-cache` 與 `vary: Cookie`。
4. （若有第二個 Google 帳號）以**未受邀**帳號登入前台：顯示「尚未受邀」與「改用其他帳號」，沒有產品清單或內容。
5. （若有測試者帳號）測試者只看到受邀產品；在後台把該帳號的產品資格移除或移除成員後，測試者重新整理即看不到內容。

## 9. Windows 常駐服務（WIN-03）

網站改由 Windows 服務執行：開機後不需登入桌面即啟動，故障自動重啟，等待資料庫就緒，日誌自動輪替，且只監聽 `127.0.0.1`。

**服務身分：虛擬服務帳號 `NT SERVICE\Chainseabase`。** 評估結果：由 Windows 自動管理、沒有密碼需要保存或輪替、有自己的 SID 可精確設定 NTFS 權限、不是系統管理員、只在本機有效；資料庫以設定檔中的密碼經 loopback 連線，與 Windows 身分無關，因此適用。不採用 LocalSystem（權限過大）或 LocalService／NetworkService（多個服務共用身分）；專用本機使用者帳號也可行，但需另外管理密碼。

| 位置 | 服務帳號權限 |
| --- | --- |
| 設定檔 `C:\ProgramData\Chainseabase\config\chainseabase.env` | 讀取（資料夾僅能列出；資料夾內其他檔案如 `env-local.backup` 無權限） |
| 頭像目錄 `C:\ProgramData\Chainseabase\data\avatars` | 修改 |
| 日誌 `C:\ProgramData\Chainseabase\logs` | 修改 |
| 程式版本 `C:\Program Files\Chainseabase\releases\<版本>` | 讀取與執行；只有其中 `.next\cache` 可修改 |
| 服務包裝程式 `C:\Program Files\Chainseabase\service` | 讀取與執行 |

服務包裝程式為 WinSW 2.12.0（安裝時自動下載，核對檔案大小與 SHA-256，不符即中止）；服務直接執行 `node.exe scripts\service\start-website.mjs`，不經 `npm.cmd`。

### 9.1 安裝

先停止開著的 `npm start`（Ctrl+C）：服務使用同一個 3000 埠。確認設定檔沒有 `E2E_TEST_LOGIN`。在應用目錄、系統管理員 PowerShell：

```powershell
git pull origin claude/keen-lamport-4qb974
.\scripts\windows\Install-ChainseabaseService.ps1
echo "exit=$LASTEXITCODE"
```

安裝會在 `C:\Program Files\Chainseabase\releases` 建立新版本（複製程式、`npm ci`、`npm run build`，需數分鐘與網路），再建立服務並等到 health 回應。可重複執行：每次建立新版本並重新套用服務設定，資料與設定不變。若需先執行 migration：`-Migrate -BackupConfirmed`（先自行備份資料庫；自動備份屬 WIN-05）。

### 9.2 驗證服務帳號與設定

```powershell
.\scripts\windows\Test-ChainseabaseService.ps1
echo "exit=$LASTEXITCODE"
.\scripts\windows\Test-ChainseabaseConfig.ps1 -AllowedReader 'NT SERVICE\Chainseabase'
echo "exit=$LASTEXITCODE"
```

`Test-ChainseabaseService.ps1` 以執行中的服務為證據：網站程序必須以 `NT SERVICE\Chainseabase` 執行、health 回 200（代表服務帳號讀得到設定檔）、只監聽 loopback；並依 SID 檢查各位置的權限、復原設定、相依 PostgreSQL、日誌輪替與 WinSW 檢查碼。復原設定與 Administrators 成員以數值與 SID 讀取，不解析 `sc.exe`／`net.exe` 的顯示文字，因此與 Windows 顯示語言無關。系統管理員 PowerShell 能讀寫，不代表服務帳號能，所以不以此為證據。

接著在瀏覽器登入並**上傳一張新頭像**、重新整理：這一步由服務帳號寫入頭像目錄。

### 9.3 故障自動恢復

```powershell
$wrapper = (Get-CimInstance Win32_Service -Filter "Name='Chainseabase'").ProcessId
$node = (Get-CimInstance Win32_Process -Filter "ParentProcessId=$wrapper AND Name='node.exe'").ProcessId
"before: $node"
Stop-Process -Id $node -Force
Start-Sleep -Seconds 60
.\scripts\windows\Set-ChainseabaseServiceState.ps1 -Action Status
echo "exit=$LASTEXITCODE"
```

預期 `exit=0`，網站程序編號與 `before` 不同（服務在 10 秒後自動重啟；連續失敗為 10／30／60 秒，1 小時後重新計數）。

### 9.4 開機恢復（未登入桌面）

```powershell
Restart-Computer
```

重新開機後**至少 3 分鐘不要登入**，再登入並執行：

```powershell
.\scripts\windows\Test-ChainseabaseService.ps1 -BootReport
echo "exit=$LASTEXITCODE"
Select-String -Path 'C:\ProgramData\Chainseabase\logs\Chainseabase.*out.log' -Pattern '"event":"(db\.wait|db\.ready|website\.ready)"' | Select-Object -Last 6
```

`-BootReport` 比較開機時間、開機後第一次 `website.ready` 與第一次互動登入時間；網站必須在有人登入前就已就緒。最後一行會列出開機時是否等待過資料庫（`db.wait`）以及就緒時間；PostgreSQL 若先完成啟動則不會出現 `db.wait`，此時等待邏輯的證據來自 CI。

### 9.5 日誌與 loopback

```powershell
Get-ChildItem 'C:\ProgramData\Chainseabase\logs' | Format-Table Name, Length, LastWriteTime
Get-NetTCPConnection -LocalPort 3000 -State Listen | Select-Object LocalAddress, OwningProcess
```

日誌依大小輪替：單檔 10 MB、保留 8 個舊檔（安裝參數 `-LogSizeKB`、`-LogKeepFiles`）；日誌只含事件名稱與錯誤類別，不含連線字串或密碼。監聽位址只能是 `127.0.0.1`。

### 9.6 啟停、更新、回退與解除安裝

```powershell
.\scripts\windows\Set-ChainseabaseServiceState.ps1 -Action Restart   # Start / Stop / Restart / Status
.\scripts\windows\Update-ChainseabaseService.ps1                     # 由目前簽出建立新版本並切換
Get-ChildItem 'C:\Program Files\Chainseabase\releases' | Select-Object Name
.\scripts\windows\Update-ChainseabaseService.ps1 -UseRelease <舊版本名稱>   # 回退
.\scripts\windows\Uninstall-ChainseabaseService.ps1                  # 只移除服務
```

- 更新先建好新版本，才停止舊版本；新版本在時限內沒有通過 health，會自動切回原版本並以 exit 1 回報。
- 停止（含更新、解除安裝）會等候服務停妥且 3000 埠釋放，最多 90 秒；故障版本正被自動重啟時也會重送停止要求，不會中途失敗。
- 回退程式不等於回退資料庫：只有相容的 migration 才能回退程式版本。
- 解除安裝只移除服務與服務帳號的權限；**不刪除**設定檔（秘密）、頭像、資料庫、日誌與備份。版本與 WinSW 預設保留，加 `-RemoveProgramFiles` 才刪除（只限程式檔）。

服務執行期間不要再用 `npm start`／`npm run dev` 佔用 3000 埠；開發時先 `Set-ChainseabaseServiceState.ps1 -Action Stop`。

## 回報內容

請回報每個步驟的輸出與 `exit=` 值（不要包含秘密），特別是：前置檢查表、`Test-ChainseabaseConfig.ps1` 的兩個 PASS／FAIL、`config:check` 的來源表、`db:migrate` 兩次與 `build` 的結尾，以及第 7 節的匯入數量與重新啟動後頭像是否仍在、第 8 節的狀態碼與各瀏覽器步驟結果，以及第 9 節每個指令的輸出與 `exit=`（含 `-BootReport` 的四個時間）。這些會記為「使用者 Windows 11 主機實測」，與 CI 執行器的結果分開記錄。
