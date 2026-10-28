# Windows 設定與安裝（WIN-01）

適用 Windows 原生部署（規格見 [Windows 原生部署規格](windows-native-deployment.md)）。本文件只涵蓋 WIN-01：前置檢查、受保護設定檔、與網站／CLI／排程一致的設定載入，以及原生 install／lint／typecheck／build。正式頭像（WIN-02）、Windows 服務（WIN-03）、受邀讀取（WIN-04）與排程備份（WIN-05）另見各任務。

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

`npm start` 透過同一個載入器啟動 `next start`，只監聽 `127.0.0.1:3000`（`npm run dev` 相同），區網其他電腦無法連線。後台 <http://localhost:3000>、前台 <http://127.0.0.1:3000>，與 `ADMIN_ORIGIN`／`PORTAL_ORIGIN` 及 Google callback 一致。在 WIN-02（正式頭像）與 WIN-04（受邀讀取）完成前，只供本機使用，**不得**經 Tunnel 或路由器對外開放；Windows 服務化、開機自動恢復與日誌在 WIN-03 處理，不以開著的 PowerShell 視窗代替。

## 回報內容

請回報每個步驟的輸出與 `exit=` 值（不要包含秘密），特別是：前置檢查表、`Test-ChainseabaseConfig.ps1` 的兩個 PASS／FAIL、`config:check` 的來源表、`db:migrate` 兩次與 `build` 的結尾。這些會記為「使用者 Windows 11 主機實測」，與 CI 執行器的結果分開記錄。
