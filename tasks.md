# 開發計畫與進度

更新日期：2026-11-02。以既有實作 `82b7641` 為基礎；不重做 M1–M7。舊任務與測試證據見 [歷史任務紀錄](docs/history/tasks.md)，本輪依 [Windows 原生規格](docs/windows-native-deployment.md) 改造。

## 目前狀態

使用者回報 Windows 11 Pro、Node 24.11.1、PostgreSQL 18.6：套件安裝、migrations 0001／0002、bootstrap 與重跑、build 退出碼 0、本機網站及 Google 真實登入成功。尚未由代理在該 Windows 主機重跑完整檢查，不能標示完整相容性通過。

| ID | 交付 | 依賴 | 狀態 |
| --- | --- | --- | --- |
| DOC-WIN | 現行需求、權限、架構、維運、驗收與 Claude 指令一致化 | 使用者確認原生部署 | 完成（文件）；不代表功能實作完成 |
| WIN-01 | PowerShell 設定持久化／安全載入、版本與安裝文件、Windows 建置和隔離測試 | 現有實作 | 完成（依規格完成條件；證據為使用者 Windows 11 實機回報 2026-10-28／29＋CI Windows Server）；主機未執行 npm test 與 E2E，服務帳號／排程讀取設定檔留待 WIN-03／05 |
| WIN-02 | 正式 filesystem 頭像、provider 設定及路徑防護 | WIN-01 設定契約 | 完成（依規格完成條件；使用者 Windows 11 實機回報 2026-10-29：初始化、ACL、重啟持久化）；服務帳號 Modify 權限（WIN-03）、頭像備份還原（WIN-05）、舊檔清理未做 |
| WIN-03 | Windows 網站／資料庫服務、重開機恢復、權限與日誌 | WIN-01、WIN-02 | 進行中：實作完成，CI `windows-2025` 完整服務生命週期通過；使用者實機回報通過服務身分、ACL、loopback、設定讀取、頭像持久化、故障自動恢復；**「未登入桌面即可完成啟動」未驗證**（2026-11-02 該次開機曾先輸入 PIN，不符合測試條件），使用者決定暫緩重測 |
| WIN-04 | 全面受邀資料讀取與角色／產品界線 | 既有身分實作 | 進行中：實作與自動化測試完成；使用者實機回報（2026-10-29）通過更新／建置、匿名 API 401、無痕頁面無內容、後台登入；頭像匿名直接存取、快取標頭、第二個未受邀 Google 帳號未實機驗證 |
| WIN-05 | 排程、獨立備份、隔離還原與告警 | WIN-02、WIN-03、備份方案 | **暫緩**：待團隊評估是否採用後，再決定本機、外接裝置或 Supabase 方案；已有 `db:restore-drill` 與 `jobs:run`（見下方 WIN-05 現況），排程、備份保存、告警與 Windows 還原未實作或未驗證；目前不建立主機備份排程或雲端備份資源 |
| WIN-06 | Tunnel、正式 host、Google／寄信／sandbox 日曆 | WIN-02～05、網域與公司政策 | 待開始 |
| WIN-07 | 30 人負載、斷網／重開機／回退與發布 | WIN-01～06 | 待開始 |

## 團隊試用前仍需完成的項目

定位：內部試用環境，不存放唯一一份重要資料。暫不合併 PR、不開 Tunnel、不對外部署。依優先順序：

**A. 讓同仁能進入並使用（阻擋試用，需決策或外部條件）**

1. **存取路徑**：網站只監聽 `127.0.0.1`，規格中唯一的對外路徑是 WIN-06（Cloudflare Tunnel、固定 HTTPS 網域、後台與前台兩個 host），且不得以開放開發埠或轉發替代。目前不開 Tunnel，其他同仁無法連線。需決定試用的存取方式；非 Tunnel 的方式（例如區網）屬規格變更，需另行確認後才實作。
2. **執行模式**：主機目前為 `APP_ENV=development`，Calendar 與寄信是開發替身（fake）。開放給他人前，規格要求 staging／production 嚴格模式：HTTPS 的 `ADMIN_ORIGIN`／`PORTAL_ORIGIN`、真實 Google 與寄信設定；fake 不得對外開放。
3. **邀請入站**：接受邀請需要邀請信中的連結，因此沒有真實寄信（Resend 已驗證寄件網域，EXT-03）時，除 bootstrap 的第一位團隊成員外，其他人無法取得資格。
4. **Google 登入與日曆**：正式 HTTPS callback 與同意畫面（測試使用者或發布狀態，EXT-02）。Google Calendar 真實讀寫只以 fake 驗證（EXT-04 sandbox 未執行）；試用時 Calendar 功能應標示未驗證，或先不納入試用範圍。

**B. 核心功能與使用流程（在試用環境以真實帳號走一遍）**

5. 自動化測試已在 Linux 與 CI Windows Server 通過，但尚未在試用環境以真實帳號人工走查。依序確認：邀請、接受與登入（team、tester）；Feedback 建立、編輯、留言與 Tag；Schedule 指令與 clear；Roadmap 拖曳與版本欄位；Personal 負責人切換與自動儲存；站內通知；前台只見受邀產品。對應驗收 A／F／S／R／P／N（[驗收案例](docs/07-delivery-and-acceptance.md)）。
6. WIN-04 尚未實機驗證的三項：頭像網址在無痕視窗直接存取、頭像快取標頭、第二個未受邀 Google 帳號（第一次讓他人登入前確認）。

**C. 試用期間的營運注意（不阻擋試用）**

7. 備份暫緩（WIN-05）：升級若含 migration，`-Migrate` 需先自行備份（`-BackupConfirmed`）；`db:restore-drill` 只做演練，不保留備份檔，也不含頭像與金鑰。
8. 背景工作沒有排程：通知與邀請信在請求內立即處理；失敗後的重試需手動執行 `npm run jobs:run`（或在後台重寄邀請）。
9. 「未登入桌面即可完成啟動」未驗證：主機重開機後若無人登入，網站是否自行就緒尚無證據；重開機後先確認網站狀態。
10. 主機上的 `npm test` 與 Windows E2E 未執行（CI Windows Server 已跑 `npm test`）；螢幕閱讀器、Safari／Firefox 與人工視覺審查（V02–V04）仍為部分完成。

## 外部條件

- Windows 服務管理權限、主機電源／休眠／更新維護時段仍須驗證。
- 獨立備份裝置尚未提供；域名、Tunnel 政策、寄件網域及 sandbox 日曆待設定。
- Google 本機 OAuth 已成功，不能據此標示 Calendar API、正式 HTTPS callback 或長期 token 刷新成功。
- Supabase staging 及 Vercel 舊資源保留；本輪不合併既有 PR、不部署、不刪資料。

每個 WIN 任務須記錄 commit、命令、退出碼、執行平台、mock／真實服務與未執行項目。只有證據齊全才標完成；文件與安裝指南不得含密碼或 token。

## WIN-01 紀錄（2026-10-28）

```text
任務：WIN-01 設定持久化與安全載入
狀態：進行中（實作完成；使用者主機實測待回報）
平台：Linux 雲端容器（Node 22.22.0、PostgreSQL 16）；Windows 部分另由 CI 的 windows-2025 執行器執行，不是使用者的 Windows 11 主機
交付：scripts/config/load-config.mjs（單一載入器，網站以 node --import 預載、CLI 第一個 import）、scripts/config-check.ts（npm run config:check）、scripts/windows/*.ps1（前置檢查、建立／設定／驗證受 NTFS ACL 保護的設定檔）、docs/windows-setup.md、migration 目錄與 CRLF／LF 檢查碼相容、npm run dev／start 只監聽 127.0.0.1、測試環境隔離 APP_ENV／CHAINSEABASE_CONFIG_FILE
本機檢查（Linux）：lint 0、typecheck 0、npm test 0（16 檔 164 tests 全過）、build 0、security:scan 0、test:e2e 0（64 passed）；npm start 在繼承 APP_ENV=staging 時 exit 78 拒絕、乾淨 development 時 health 200 且只監聽 127.0.0.1
CI 新增：win-native（PowerShell 5.1／7 解析、前置檢查、npm ci／lint／typecheck／build、建立設定檔與 ACL 正反測試、URL 無密碼＋PGPASSWORD 的 migrate／bootstrap、衝突 exit 78、Windows 上 npm test）；pg18-node24（Linux 上 Node 24.11.1＋PostgreSQL 18 的 migration 與 npm test）；結果記於 PR
未完成：使用者主機的 bootstrap 重跑、lint／typecheck／build 與各步 exit 值；E2E 未在 Windows 執行；WIN-03 服務帳號讀取設定檔、WIN-05 排程讀取設定檔尚待驗證
```

```text
來源：使用者 Windows 11 實機回報（2026-10-28；代理未在該主機執行，與 CI 分開記錄）
通過（使用者回報）：PostgreSQL 改為只監聽 localhost 後前置檢查通過；受保護設定檔建立；NTFS ACL 與 config:check 通過；以設定檔執行 migration 顯示 Database schema is up to date；npm start 與 Google 重新登入成功
問題：Test-ChainseabaseConfig.ps1 參數預設值的 $PSScriptRoot 為空字串，Split-Path 失敗；明確 -AppDirectory 可通過
修正：預設目錄改在腳本本體計算並驗證應用目錄（不符時 exit 1 並提示 -AppDirectory）；CI win-native 在 PowerShell 7／5.1 重現空 $PSScriptRoot 並檢查；待主機以不帶 -AppDirectory 重新確認
```

## WIN-02 紀錄（2026-10-28）

```text
任務：WIN-02 正式 filesystem 頭像儲存與設定
狀態：進行中（實作完成；使用者主機實測待回報）
平台：Linux 雲端容器（Node 22.22.0、PostgreSQL 16）；Windows 部分由 CI 的 windows-2025 執行器執行，不是使用者的 Windows 11 主機
交付：FilesystemAvatarStorage（固定根目錄、物件路徑白名單＝<uuid>/<16 字元>.webp、拒絕穿越／裝置名稱／ADS／連結與 junction、暫存檔＋fsync＋rename 原子寫入、錯誤拋出並記錄 avatar_store_failed／avatar_read_failed）；STORAGE_PROVIDER=filesystem|supabase|fake（舊值 real＝supabase）與 AVATAR_STORAGE_DIR（絕對本機路徑、須在應用目錄外，所有環境皆檢查）；health 回報 storageBackend；上傳串流讀取超過 2 MB 即中止；config:check 檢查根目錄存在且可寫；Initialize-ChainseabaseAvatarStorage.ps1（建立／ACL／匯入 .data\avatars、不覆寫不刪來源、拒絕改指向既有根目錄）；Test-ChainseabaseConfig.ps1 檢查頭像目錄 ACL
本機檢查（Linux）：lint 0、typecheck 0、npm test 0（17 檔 180 tests 全過）、build 0、security:scan 0；放寬路徑白名單時穿越測試失敗（變異檢查）；複製的應用目錄以 npm start＋設定檔實測：上傳、停止、重新啟動後頭像位元組相同，檔案只在 AVATAR_STORAGE_DIR
CI 新增（win-native）：Initialize 腳本拒絕應用目錄內／UNC 路徑、匯入與冪等、拒絕改指向、頭像目錄 ACL 正反測試、config:check 回報 filesystem；npm start 重新啟動前後頭像相同且只監聽 loopback；Windows 上 junction 防護單元測試
未完成：使用者主機的第 7 節實測；WIN-03 服務帳號的 Modify 權限與服務重啟；WIN-05 頭像備份與還原；頭像讀取需登入與快取改為 private 屬 WIN-04（目前 /api/v1/avatars 仍允許匿名讀取與 public 快取，不得經 Tunnel 開放）；舊頭像檔案在更換後不刪除（無清理）
```

## 使用者 Windows 11 實機回報（2026-10-29，e4e6e41）

```text
來源：使用者在自己的 Windows 11 主機執行並回報；代理未在該主機執行，與 CI（Windows Server 執行器）分開記錄
WIN-01：Test-ChainseabaseConfig.ps1 不帶 -AppDirectory exit=0（f59e1bb 修正已確認）；db:migrate、db:bootstrap、lint、typecheck、build 皆 exit=0
WIN-02：Initialize-ChainseabaseAvatarStorage.ps1 與其後的 Test-ChainseabaseConfig.ps1（設定／ACL）皆 exit=0；上傳頭像後停止並重新啟動網站，重新整理仍保留；C:\ProgramData\Chainseabase\data\avatars 檔案數 1；網站監聽 127.0.0.1:3000
評估：WIN-01 完成條件（管理員權限、Node／npm／Git／PostgreSQL、原生 install／lint／typecheck／build）與 WIN-02 完成條件（路徑防護、權限、重啟持久化、正式拒絕 fake）已有證據 → 標為完成
仍未驗證（不屬已完成範圍，保留）：主機上的 npm test 與 Windows E2E；WIN-03 服務帳號讀取設定檔與頭像目錄 Modify 權限、服務重啟；WIN-05 排程讀取設定檔、頭像與資料庫備份還原；重開機後自動恢復
```

## WIN-04 紀錄（2026-10-29）

```text
任務：WIN-04 公司內容全面受邀登入控制
狀態：進行中（實作與自動化測試完成；使用者本機驗證待回報）
平台：Linux 雲端容器（Node 22.22.0、PostgreSQL 16）；CI 另在 Windows Server 執行器跑同一套 npm test
規則（依 data-permissions.md 與 API 契約 WIN-04 修訂）：
  讀取 /public/*（產品、Feedback、搜尋、留言、Roadmap 與欄分頁）、/avatars/:u、通知列表：未登入 401；未受邀、已移除帳號、測試者讀其他產品 → 404，與不存在相同，且在查詢產品前判斷
  /public/products：團隊全部、測試者只列受邀產品、未受邀／已移除為 []
  頭像：團隊全部；測試者可讀自己、團隊、同產品成員與其受邀產品中的作者；Cache-Control private, no-cache＋Vary: Cookie＋ETag，304 也先驗證授權
  寫入（前台互動、頭像上傳）：未受邀／已移除 403 NOT_A_MEMBER，在查詢產品前判斷
  撤銷資格：每次請求重新讀取 session 與 product_access，無快取；移除成員或產品資格後下一個請求即失效
  前台頁面：未登入顯示「請先登入」、未受邀顯示「尚未受邀」（依 /me 的 role），不預載任何產品內容；手機版頁首改為可換行
測試：新增 tests/integration/invited-access.test.ts（8 tests：匿名、未受邀、已移除 team／tester、跨產品 404 與不存在相同、撤銷產品資格、團隊全產品、頭像可見範圍與快取、通知與寫入不可探測產品）；既有 F09～F15、R14、A02、N05 改以受邀測試者讀取或改為新規則（斷言保留）；E2E 新增匿名登入提示、未受邀提示、受邀測試者只見公開項目
本機檢查（Linux）：lint 0、typecheck 0、npm test 0（18 檔 188 tests）、test:e2e 0（65 passed）、build 0、security:scan 0；移除成員資格檢查的變異使 WIN-04 測試失敗（5／8、3／23）；複製的應用目錄以 npm start 驗證：匿名 API 401、未受邀 []／404、頭像 401／404／200 與快取標頭、頁面 HTML no-store 且不含標題
未完成：使用者本機第 8 節驗證；真實 Google 未受邀帳號流程（需第二個帳號）；Tunnel／對外仍待 WIN-03／06 與授權
```

## 使用者 Windows 11 實機回報：WIN-04（2026-10-29，6f45809）

```text
來源：使用者在自己的 Windows 11 主機執行並回報；代理未在該主機執行
通過（使用者回報）：更新到 6f45809、安裝與建置；docs/windows-setup.md 第 8 節的三個匿名 API 皆為 401；無痕視窗的前台頁面不顯示公司內容；後台以團隊帳號登入查看正常
未實機驗證（無獨立證據，不推定通過）：頭像網址在無痕視窗直接存取、頭像回應的快取標頭（cache-control／vary）、第二個未受邀 Google 帳號的「尚未受邀」流程；這三項僅有代理在 Linux 容器與 CI 的自動化證據
狀態：WIN-04 維持進行中，待上述三項實機證據
```

## WIN-03 紀錄（2026-10-29）

```text
任務：WIN-03 Windows 常駐網站服務
狀態：進行中（實作與 CI 驗證完成；重開機未登入桌面恢復待使用者主機）
服務身分：虛擬服務帳號 NT SERVICE\Chainseabase（無密碼、專屬 SID、非 Administrators）；評估與權限表見 docs/windows-setup.md 第 9 節
權限（依 SID）：設定檔讀取（資料夾僅列出、其他檔案無權限）；頭像根目錄、日誌、release 的 .next\cache 修改；release 與 WinSW 讀取／執行
交付：scripts/windows/ Install-／Update-／Set-ChainseabaseServiceState／Uninstall-／Test-ChainseabaseService.ps1、ChainseabaseService.psm1；scripts/service/start-website.mjs（等待資料庫、只監聽 127.0.0.1、wrapper 消失即結束）、wait-for-database.mjs；/health 在資料庫不可用時 503
包裝：WinSW 2.12.0 x64，下載後核對大小與 SHA-256（Authenticode：NotSigned，以固定檢查碼代替）；延遲自動啟動、相依 PostgreSQL 服務；失敗 10／30／60 秒重啟、3600 秒重設、非 0 結束也套用；日誌依大小輪替
本機檢查（Linux 容器）：lint／typecheck 0；npm test 0（20 檔 197 tests，含 wait-for-database 3、service-entry 5、health 503 1）；看門狗關閉的變異使 wrapper 消失測試失敗
CI win-native（GitHub Actions windows-2025、PostgreSQL 17 服務；push 跑 bd35a9c、pull_request 跑合併提交；兩者 success）：
  https://github.com/amber-ou/Chainseabase/actions/runs/40840399096（push）、https://github.com/amber-ou/Chainseabase/actions/runs/40840406841（pull_request）
  安裝與重跑、Test-ChainseabaseService 全部 PASS（以執行中的服務為證據：程序擁有者、loopback、health、依 SID 的權限）、Test-ChainseabaseConfig -AllowedReader
  強制結束 node → 自動重啟；強制結束 WinSW → node 自行結束（events.log 記錄 service.wrapper_exited）且服務重啟，無殘留程序佔用埠
  資料庫延遲：指向未開放的埠，服務記錄 db.wait（ECONNREFUSED）、health 非 200；開放後 db.ready（第 2 次以上嘗試）並恢復
  日誌輪替：8 KB／保留 3 → 3 個舊檔＋1 個現行檔；日誌不含連線字串
  版本切換、故障版本（移除 .next\server）exit 1 並自動回退到健康版本、再切回；解除安裝兩次：設定檔雜湊、頭像數量不變，日誌保留，設定檔無服務 SID，3000 埠釋放
修正（CI 發現）：wrapper 被終止時 node 成為孤兒佔用 3000 埠（加 --exit-with-parent 看門狗與「恰一個服務 node」檢查）；故障版本被自動重啟時 Stop-Service 失敗導致回退中斷（停止改為重試至停妥且埠釋放）
未完成：使用者主機第 9 節（安裝、權限、頭像上傳、故障恢復、Restart-Computer 後未登入 -BootReport）；開機時資料庫較晚就緒的等待只在 CI 以延遲連線模擬；WIN-05 排程、備份
```

## 使用者 Windows 11 實機回報：WIN-03（2026-10-30，繁體中文顯示語言）

```text
來源：使用者在自己的 Windows 11 主機執行並回報；代理未在該主機執行
通過（使用者回報）：Install-ChainseabaseService.ps1 exit 0；Test-ChainseabaseService.ps1 除 recovery 一項外全部 PASS
recovery 項目：FAIL，但 sc.exe qfailure Chainseabase 顯示 RESET_PERIOD 3600 秒、RESTART 10000／30000／60000 毫秒，與安裝設定相同
判定：設定正確、驗證工具誤判。原檢查以 RESET_PERIOD[^:]*:\s*3600 解析 sc.exe 文字；繁中輸出為「RESET_PERIOD (單位: 秒) : 3600」，標籤內的冒號使比對失敗
修正：recovery 改讀服務登錄機碼的結構化數值（FailureActions 二進位：重設秒數、各動作類型與延遲；FailureActionsOnNonCrashFailures），不讀任何顯示文字，且改為逐項比對安裝設定（恰 3 個 restart、10／30／60 秒、3600 秒、錯誤結束也套用）；缺值或無法辨識的格式判 FAIL。Administrators 成員的備援檢查同樣由 net.exe 文字改為 ADSI 讀 SID
測試：tests/windows/ServiceRecovery.Tests.ps1（正確設定、重設 60 秒、延遲不同、2 個或 0 個動作、無動作／重新開機、錯誤結束不套用、旗標缺少、缺值、截斷、筆數不符；繁中輸出使舊樣式誤判的回歸案例；ADSI 與 Get-LocalGroupMember 一致）於 CI PowerShell 7 與 5.1；CI 服務測試另在已安裝服務上改成錯誤設定，確認只有 recovery 一項 FAIL，還原後全檢通過
未測（不推定通過）：使用者主機上的故障恢復（第 9.3 節）、頭像上傳、未登入桌面的重開機恢復（第 9.4 節）；修正後的 Test-ChainseabaseService 尚待主機重跑
```

## 使用者 Windows 11 實機回報：WIN-03 開機（2026-10-30 下午）

```text
來源：使用者在自己的 Windows 11 主機執行並回報；代理未在該主機執行
通過（使用者回報）：服務身分、ACL、loopback、設定讀取、頭像、故障恢復
BootReport：FAIL。Boot 14:02:19；wrapper 14:05:45；第一次 website.ready 14:06:47；工具判定第一次互動登入 14:02:30（開機後 11 秒），使用者表示停在登入畫面等待
原因（程式）：舊判定只看 Win32_LogonSession 的 LogonType 2／10／11 與時間，未檢查帳號；Windows 每次開機都會以 LogonType 2 建立 DWM-n（S-1-5-90-…）與 UMFD-n（S-1-5-96-…）工作階段。14:02:30 那筆的帳號類型尚待使用者以 docs/windows-setup.md 9.4 的唯讀指令確認（也可能是 ARSO 代為登入）；未改判為通過
修正：登入以 SID 分類（person／windows／unknown，unknown 視同登入），來源為現存工作階段與安全性記錄檔 4624（含已結束者），列出帳號、SID、LogonType、LogonId、Windows 工作階段編號；讀不到安全性記錄檔判 FAIL；顯示 AutoAdminLogon 與 ARSO 設定（唯讀、不讀密碼）。BootReport 另列開機時間軸（PostgreSQL 服務程序、wrapper、website.starting、資料庫等待、db.ready、website.ready 與開機後經過時間）
另修正：Test-ChainseabaseService 與 Set-ChainseabaseServiceState 讀取程序擁有者時，程序在列舉後結束（HRESULT 0x80041002）改為有限次（3 次）重新取樣；其他錯誤（拒絕存取、GetOwner 回傳錯誤）仍回報 FAIL
測試：tests/windows/BootReport.Tests.ps1（SID 分類、依實機時間序列挑出第一個使用者登入、舊篩選的回歸案例、無法辨識的帳號視同登入、已結束程序的 0x80041002、其他 GetOwner 錯誤仍拋出、CI 主機的實際 DWM／UMFD 工作階段分類）於 CI PowerShell 7 與 5.1；CI 服務測試另以 -BootReport 跑完整流程（CI 主機開機早於服務安裝，其登入判定不作為開機證據）
耗時分析（開機到就緒 4 分 28 秒）：開機→wrapper 3 分 26 秒，主要為 delayed-auto（一般自動啟動服務完成後再延後約 2 分鐘）與相依 PostgreSQL 服務；wrapper→website.ready 62 秒，含 Node／Next.js 冷啟動，是否有資料庫等待需新版時間軸確認
未測：登入前開機恢復（待修正後的 BootReport 與唯讀診斷）
```

## 使用者 Windows 11 實機回報：WIN-03 開機（2026-11-02，台灣時間）

```text
來源：使用者在自己的 Windows 11 主機執行並回報；代理未在該主機執行；與 CI 證據分開
檢查工具版本：51fb7dc（Test-ChainseabaseService.ps1 -BootReport）
時間軸：開機 14:25:20；PostgreSQL 啟動 14:25:37（+17 秒）；服務包裝程式啟動 14:27:49（+2 分 29 秒）；website.starting 14:27:53；db.ready 14:27:55；website.ready 14:28:00（+2 分 40 秒）；Database waits 0
首次 person 登入：14:25:53（開機後 33 秒）；AutoAdminLogon off；該使用者 ARSO OptOut=1
BootReport：FAIL，退出碼 1
使用者確認：這次開機後曾先輸入 PIN 才等待，因此不符合「登入前網站就緒」的測試條件
判定：不是服務啟動故障，也不是驗收通過。本次網站在開機約 2 分 40 秒後就緒；資料庫未等待，耗時主要在延遲自動啟動（PostgreSQL 啟動後約 2 分 12 秒才啟動服務包裝程式），網站本身啟動約 11 秒
結論：「未登入桌面即可完成啟動」仍未驗證；使用者決定暫緩重測，不再要求反覆重開機，也不修改 Windows 登入設定
既有實機通過項目保留：服務身分、ACL、loopback、設定讀取、頭像持久化、故障自動恢復
```

## WIN-05 現況（2026-11-02）

```text
狀態：暫緩。等待團隊評估是否採用後，再決定本機、外接裝置或 Supabase 方案；目前不建立主機備份排程或雲端備份資源
已有程式（保留，如實記錄）：
  scripts/restore-drill.ts（npm run db:restore-drill）：pg_dump 來源資料庫、pg_restore 到名稱須含 drill 的隔離資料庫，比對每張表行數與私人資料摘要；暫存的備份檔在結束時刪除。歷史紀錄：曾在 Linux 開發環境執行一致（41 張表）；Windows 主機與 Supabase 未執行；以 SOURCE_DATABASE_URL／TARGET_DATABASE_URL 指定，未經設定檔載入器
  scripts/run-jobs.ts（npm run jobs:run）：執行一批 outbox 工作（通知展開、邀請信），經設定檔載入器；手動執行，無排程
  /api/v1/jobs/run：以 JOB_RUNNER_SECRET 保護的工作端點（舊 Vercel Cron 用）
未實作：定期備份與保存、防重疊、裝置離線與容量告警、頭像與金鑰備份、Windows 工作排程器設定
未驗證：Windows 主機上的隔離還原、還原耗時與資料損失範圍（WIN-05 完成條件）
```

## UI-01：shadcn/ui 元件庫（2026-11-02）

完成本地整合：10 個指定元件＋Field／Label／Separator、Tailwind 4 與既有 Taste tokens、官方 shadcn skill（Codex／Claude Code），現有 Product Dashboard 首批遷移。路由、API、資料結構與商業邏輯未修改；其餘頁面保留。

驗證：npm ci、lint、typecheck、production build／啟動及 security scan 通過；197 個單元／整合測試在具子程序回收的測試環境通過。既有 E2E 初次 64／65 通過，1 個鍵盤焦點案例經未修改版本對照與整合版本連續 3 次重跑通過。新增 Product E2E 6／6、元件隔離測試 3／3 通過。真實 Google／Resend 與 Windows 實機未重驗。

來源版本、手動安裝原因、測試限制與後續元件規範見 [shadcn/ui 整合紀錄](docs/ui/shadcn-integration.md)。

CC 驗證（2026-11-02，Linux 容器）：fast-forward 取得 `1960af5`；依賴來源、官方 skill、元件原始碼與 CSS layer／Preflight 已逐項核對；lint、typecheck、build、security:scan 皆 0；`npm test` 197 passed；`test:ui` 3 passed；`test:e2e` 74 passed（新增只用鍵盤操作產品對話框與切換器的案例）。Taste inspector、Windows 主機與真實 Google／Resend 未執行。官方 registry 目前在此環境不可達；成果由 `codex/ui-phase1-handoff` 分支交接，未部署。

## UI-02：側邊欄順序與上下分組（2026-11-03）

範圍：只調整側邊欄位置與分組（[變更需求](docs/change-requests/sidebar-position.md)「側邊欄配置」，不含 Calendar）。上方 Product → Feedback → Roadmap → User → Live Portal；下方 Personal → Notification → Setting，位於帳號區上方，與上方同樣間距；兩組之間為彈性留白（矮視窗最少 12px）。同一個 `後台導覽` nav、既有樣式、圖示、點擊行為、權限、路由、產品選擇器與帳號／登出區不變，手機選單使用同一份導覽。

連帶修正：Notification 浮層原本固定向下開啟並放在可捲動的側邊欄內；移到下方後會蓋住 Setting 與帳號區並超出視窗。改為依按鈕位置以視窗定位，往空間較大的一側開啟並限制高度。舊版也已在右緣被側邊欄裁切（「全部標為已讀」被截斷，已用舊程式重現），此修正一併解決。前台頁首的 Notification 仍向下開啟。

修改檔案：`src/features/admin/shell.tsx`、`src/app/globals.css`（`.nav` 加分組規則）、`tests/e2e/admin.spec.ts`（順序斷言）、新增 `tests/e2e/sidebar.spec.ts`、`playwright.config.ts`（平板／手機專案納入 sidebar 測試）。

驗證（Linux 容器）：lint、typecheck、build、security:scan 皆 0；`npm test` 197 passed；`test:ui` 3 passed；`test:e2e` 83 passed（新增 9 個：1440、768、390 各含一般與矮視窗 1440×560／768×500／390×560，檢查順序與各一次、視覺順序與 DOM 一致、圖示與文字左緣對齊、下方三項等距、帳號區位置、登出可達且不被遮擋、Tab 順序與視覺一致；以及各寬度 Notification 浮層完整在視窗內且未被遮擋）。

未做：Calendar 入口（第三階段）、Product 清單、產品刪除、Logo／Login 改版；Taste inspector 未執行；Windows 主機未重驗。

## UI-03：Calendar 入口與頁面、Product 產品清單（2026-11-03）

範圍：[變更需求](docs/change-requests/sidebar-position.md)「側邊欄配置」「Product：產品清單」「Calendar：承接既有 Google 日曆」；不含產品刪除（第四階段，未放置任何刪除控制）、Logo／Login 改版。API、資料結構、商業邏輯與權限未改。

- 側邊欄九項：上方 Product → Calendar → Feedback → Roadmap → User → Live Portal，下方 Personal → Notification → Setting；Calendar 用既有圖示集的 `IconCalendar`；保留第二階段 Notification 浮層定位。
- Calendar：新路由 `/products/[id]/calendar`，h1 Calendar 並顯示目前產品名稱；沿用同一個 `CalendarPanel`（授權、綁定、月／週／清單、活動新增／編輯、錯誤處理，未新增第二套邏輯）。授權返回位址取自目前頁面，所以從 Calendar 連結會回到 Calendar；側邊欄切換產品時保留 Calendar 並換成該產品自己的綁定。
- Product：`/products/[id]/dashboard` 仍是 Product（不導向 Calendar），h1 固定 Product；移除副標、頁首產品下拉與重新命名按鈕；保留「新增產品」。平整清單列出實際產品（含「產品1」），目前產品以「目前產品」標示；點選列切換目前產品並與側邊欄選擇器同步（焦點留在該列）。每列「{名稱} 的操作」選單只有「重新命名」：Dialog 顯示目前名稱、取消／儲存，使用清單最新 revision；失敗保留輸入；關閉後焦點回到該列選單按鈕；slug 不變。手機觸控區至少 44px，長名稱截斷不遮擋操作。
- 舊網址：`/products/[id]` 仍導向 Product；舊的日曆授權返回 `/products/[id]/dashboard?calendar=…` 轉到 `/calendar` 並保留參數。

修改檔案：`src/features/admin/shell.tsx`、`src/features/dashboard/dashboard.tsx`（改為 `ProductListPage`）、`src/app/products/[productId]/dashboard/page.tsx`、新增 `src/app/products/[productId]/calendar/page.tsx` 與 `src/features/calendar/calendar-page.tsx`；測試 `tests/e2e/shadcn.spec.ts`（改寫為產品清單）、新增 `tests/e2e/calendar-page.spec.ts`、`sidebar.spec.ts`／`admin.spec.ts`（九項順序與標題）、`calendar.spec.ts`／`keyboard.spec.ts`（日曆改在 Calendar 頁）、`a11y.spec.ts`／`responsive.spec.ts`（加入 calendar）、`playwright.config.ts`（平板／手機納入 calendar-page）。

驗證（Linux 容器，第三方為 fake）：lint、typecheck、build、security:scan 皆 0；`npm test` 197 passed；`test:ui` 3 passed；`test:e2e` 100 passed（1440／768／390：清單內容與移除項目、建立／列內重新命名／連續兩次重新命名、清單與側邊欄選擇器雙向同步、slug 不變、409 保留輸入、純鍵盤建立／選取／選單／重新命名、Escape 焦點返回、長名稱與 44px 觸控、Calendar 開啟與產品切換不混用綁定、舊網址；日曆授權與活動操作沿用 C05／C16 與鍵盤日曆案例，axe 與無溢出涵蓋 Calendar 頁）。過程中測試抓到一個本階段缺陷：列選單關閉時一律阻止焦點返回，Escape 後焦點遺失；已改為只在開啟重新命名時阻止。

未做：產品刪除（第四階段）、Logo／Login；沒有產品時的空清單（目前無法刪除產品，第四階段處理）；Taste inspector；Windows 主機與真實 Google 未重驗。

## UI-04：產品永久刪除、防呆 Modal 與無產品狀態（2026-11-03）

範圍：[變更需求](docs/change-requests/sidebar-position.md)「永久刪除產品」「防呆 Modal」「一致性與刪除後導覽」；不含 Logo／Login。只新增刪除所需的 API、資料層與 UI，未改其他業務邏輯或依賴版本。

- API：`DELETE /products/:p`（[契約](docs/04-api-contracts.md)）。團隊可刪；測試成員／無角色 403、未登入 401、前台 host 404、跨來源 403。`If-Match` revision 必填（缺 428、過期 409），`confirmName` 必須與目前名稱完全相同（400）。zod strict，多餘欄位 400。
- 資料：`deleteProduct`（`src/modules/products/service.ts`）單一交易，先 `for update` 鎖產品列；並行寫入因外鍵等待後失敗為 404，不留孤兒列。刪除：通知；該產品事件與其 outbox 工作；日曆綁定、活動關聯與日曆操作紀錄；所有成員在此產品的 Personal 檢視／欄／卡位、私人標籤與私人備註；Roadmap 看板、欄與排序；Schedule 列／內容／操作；留言、按讚、投票、Feedback 與其 Tag／職掌；職掌與成員職掌、Tag、群組、類別、狀態；產品存取；邀請與此產品的關聯；此產品的冪等紀錄；最後刪除產品列。保留：其他產品、帳號、session、個人 Google 授權、邀請本身（只移除此產品關聯）、bootstrap 團隊資格。不呼叫 Google：日曆、活動與 ACL 不變。
- 初始化：新增 migration `0003_product_tombstones.sql`。刪除有系統鍵的產品（初始「產品1」）時記下該鍵，`bootstrap` 見到 tombstone 不再建立；首次空資料庫仍建立「產品1」。
- UI：列「⋯」選單在重新命名下方加分隔與危險色「刪除產品」。AlertDialog（官方 shadcn 元件）：標題「永久刪除產品『名稱』？」、影響範圍、Google 不受影響、「輸入產品名稱以確認」（初始空白、顯示完整名稱），完全一致才啟用「永久刪除」。初始焦點在輸入框，Enter 不送出。「刪除中…」期間不可重送或關閉。409 時確認失效且不可重試，並刷新清單；400／403 顯示原因且未刪除。網路錯誤或 5xx 先查產品清單：已不在清單才回報刪除，仍在則說明未刪除，查不到則顯示「重新檢查」。404 回報「已不存在」。
- 刪除後：刪其他產品時保留目前選取，焦點移到相鄰列；刪目前產品時清除選取（`csb:lastProduct` 設為空），返回 `/products`，焦點在標題。`/products` 依記錄決定：從未選過則開第一個產品；記錄的產品仍存在則開它；已清除或產品已不存在則顯示未選取清單；零產品顯示「尚無產品」與「新增產品」（官方 Empty 元件）。
- 側邊欄無產品模式：只有 Product 可開；其他項目為 `aria-disabled`，並以「請先從 Product 選取產品／請先在 Product 新增產品」提示，不發出產品請求（Notification 不輪詢）。舊網址顯示「找不到產品，可能已被刪除」與「返回 Product」，不請求該產品資料。只記住確實存在的產品。新增產品對話框說明改為可重新命名或永久刪除。

修改檔案：
- 後端：`db/migrations/0003_product_tombstones.sql`（新增）、`scripts/bootstrap-lib.ts`、`src/modules/products/service.ts`、`src/server/api/routes-products.ts`。
- UI：`src/components/ui/alert-dialog.tsx`、`src/components/ui/empty.tsx`（新增，見 [shadcn 規範](docs/ui/shadcn-integration.md)）、`src/features/dashboard/dashboard.tsx`、`src/features/admin/shell.tsx`、`src/app/products/page.tsx`、`src/app/globals.css`。
- 測試：新增 `tests/integration/product-delete.test.ts`、`tests/e2e/product-delete.spec.ts`、`tests/e2e/product-empty.spec.ts`；修改 `tests/helpers/harness.ts`、`tests/e2e/helpers.ts`、`tests/e2e/shadcn.spec.ts`、`playwright.config.ts`（平板／手機納入 product-delete；新增專案 `empty-last` 依賴其他三個專案，最後執行）。
- 文件：`docs/04-api-contracts.md`、`docs/01-product-requirements.md`、`docs/02-architecture-and-data.md`、`docs/07-delivery-and-acceptance.md`（A09）、`docs/08-decisions.md`（D03 已取代）、變更需求狀態。

驗證（Linux 容器，隔離 test／e2e 資料庫；Google、Email 為 fake，屬 mock）：
- lint、typecheck、build、security:scan（745 檔）、`git diff --check` 皆 0。
- `npm test`：21 檔 209 passed。新增 12 個整合案例：
  - 依資料庫目錄自動盤點所有直接或經外鍵屬於產品的表，刪除前每張表都有資料，刪除後全為 0；另一產品逐表筆數不變；帳號、session、Google 授權、邀請不變。
  - fake Google 無任何呼叫，日曆與活動不變；舊網址、前台與 API 皆 404。
  - 名稱不符（前綴、前後空白、大小寫）、過期／缺少 revision、權限、重複請求、交易中途失敗完整回滾、與寫入並行、兩人同時刪除、已排隊工作不再執行、刪光後重跑初始化不復活、首次初始化仍建立。
- `test:ui` 3 passed。
- `test:e2e` 116 passed、0 failed：
  - 1440／768／390 各 5 個刪除案例：
    - 刪除其他產品：長名稱、矮視窗、axe、焦點。
    - 刪除目前產品：導回、側邊欄停用、舊網址、刪除後無產品請求、axe。
    - 純鍵盤操作：Enter 不送出、Tab 順序、Escape／取消焦點返回、重開清空。
    - 送出狀態：刪除中僅送一次且不可關閉；5xx、網路失敗、400、409 不顯示成功；回應遺失時核對後才回報。
    - 他人已先刪除。
  - `empty-last` 在其他專案後刪光全部產品（含產品1），三種尺寸的空清單皆通過 axe、無溢出，並可從空狀態新增產品。
  - 第一輪完整執行有 3 個失敗：矮視窗量測在視窗縮小後立即讀取位置。改為等版面完成後量測（實測 1440 為 y≈8、高 465／480），重跑全數通過；元件未修改。

未做／限制：
- 已送出的 Google 日曆請求若與刪除同時發生，Google 端可能已建立或修改活動，平台寫入關聯時則因產品不存在而失敗，活動留在 Google（屬 Google 資料，本來就不刪除）。
- Taste inspector、Windows 主機與真實 Google／Resend 未驗證。

### UI-04 補強：邀請與進行中的 Google 操作（2026-11-03）

依使用者確認的規則（[變更需求](docs/change-requests/sidebar-position.md)「永久刪除產品」）：

- **邀請**：產品刪除交易內，先鎖定產品，再依 id 順序鎖定所有連到它的邀請，移除關聯後重新計算。
  - 尚未接受、未撤銷（含已過期）且已無任何產品的測試邀請：撤銷，保留紀錄（`revoked_reason = 'product_deleted'`，revision +1），排隊中的 `invitation.send` 工作標為 `cancelled`。
  - 仍有其他產品的邀請：只移除關聯，狀態與工作不變。
  - 已接受的邀請、團隊邀請：不變，帳號與其他產品資格保留。
  - 手動撤銷記為 `manual`，同 Email 新邀請取代記為 `superseded`。邀請列表顯示「已撤銷（產品已刪除）」，產品欄顯示「（無產品）」。
- **重新檢查**：
  - 寄送工作在鎖定邀請後，若是沒有產品的測試邀請就不寄。
  - 重寄時，若是沒有產品的測試邀請則 410。
  - 接受時：撤銷、過期、已被他人使用、沒有產品，一律 410，訊息以「邀請已失效」開頭，不消耗邀請、不改帳號。
- **邀請頁**：新增 `POST /invitations/inspect`（需登入、zod strict、不消耗邀請、不透露邀請內容）。連結開啟即檢查，無效時顯示標題「邀請已失效」與原因，不顯示「接受邀請」。若在開啟後才失效，按下接受會得到同樣的畫面，不顯示「已加入」。
- **鎖順序**：接受邀請先以 FOR SHARE 鎖定受邀產品、再鎖邀請，與刪除的「產品 → 邀請」一致，避免死鎖。
  - 刪除先：接受等待後得到 410。
  - 接受先：刪除等待；接受成立，之後刪除照常移除該產品的存取。
  - 同一邀請的兩個產品同時刪除：後者在鎖後重新計算，邀請必定撤銷。
- **Google 進行中的操作**：刪除時已送出的 Google 建立／修改可能完成（接受此限制，不刪 Google 活動補償）。完成後寫回平台紀錄或關聯時，若產品已刪除，回應 404「此產品已被刪除；Google 上的變更可能已完成，平台未保存任何關聯或紀錄」，不回報成功。之後以同一冪等鍵重試或任何新操作都在呼叫 Google 前 404。平台沒有日曆背景工作或自動重試。
- **Migration**：`0004_invitation_revoke_reason.sql`（`invitations.revoked_reason`；`outbox_jobs.state` 增加 `cancelled`）。

修改檔案：
- 後端：`db/migrations/0004_invitation_revoke_reason.sql`（新增）、`src/modules/identity/invitations.ts`、`src/modules/products/service.ts`、`src/modules/calendar/service.ts`、`src/server/api/routes-identity.ts`。
- UI：`src/features/invite.tsx`、`src/features/users/users-page.tsx`。
- 測試：`tests/integration/product-delete.test.ts`、`tests/e2e/product-delete.spec.ts`。
- 文件：`docs/04-api-contracts.md`、變更需求、本文件。

測試（新增 10 個整合案例，真實 PostgreSQL；寄信與 Google 為 fake）：
- 單產品邀請撤銷：保留紀錄，工作 `cancelled`，不寄信，不可重寄。
- 已寄出的信：inspect 顯示失效，接受 410，帳號不變。
- 多產品邀請：只移除關聯，之後寄出並只獲得剩下的產品。
- 已接受的邀請：不撤銷，帳號與其他產品資格保留。
- 團隊邀請不受影響。
- 寄送與接受的重新檢查：無產品關聯的邀請、被放回佇列的工作。
- 接受與刪除同時發生：以交易閘門控制兩種先後順序。
- 同一邀請的兩個產品同時刪除。
- Google 建立途中產品被刪除：含與不含 Feedback 關聯；回 404、不留平台紀錄、重試與新操作不呼叫 Google。

E2E 新增邀請頁兩案（1440／768／390）：開啟即顯示「邀請已失效」且沒有接受按鈕（含 axe 檢查）；開啟後才失效。邀請頁 E2E 以攔截回應驗證畫面（屬 mock），伺服器規則由整合測試驗證。

驗證結果（Linux 容器，隔離 test／e2e 資料庫）：lint、typecheck、build、security:scan（751 檔）、`git diff --check` 皆 exit 0；`npm test` 21 檔、219 passed；`test:ui` 3 passed；`test:e2e` 122 passed、0 failed。

已知並行限制：
- 邀請信正在寄送時刪除產品：寄送工作持有邀請鎖，信會寄出，刪除會等到寄送結束（最長為寄信服務逾時）；信中的連結開啟後顯示「邀請已失效」。
- 接受早於刪除：該測試成員帳號保留但沒有任何產品，與其他產品被刪除後的既有測試成員相同（規則 3）。

## UI-05：品牌 Logo 與 Login 版面（2026-11-04）

範圍：[變更需求](docs/change-requests/sidebar-position.md)「Logo 更新」「Login 版面調整」。產品、資料庫、API、商業邏輯與依賴未改。

- **Logo**：Windows 原始檔在雲端環境讀不到，未重畫或替代；使用者改由 `origin/codex/ui-phase1-handoff` 的 `1f4f4de` 交付，以 fast-forward 取得。`public/brand/chainsea-logo.png` 為 1800×1800 RGBA，SHA-256 與 `public/brand/README.md` 一致，四角完全透明，可見範圍 352–1452 × 345–1453。
  - `BrandMark`（`src/components/brand.tsx`）直接引用 `/brand/chainsea-logo.png`，原檔不裁切、不縮放、不重新編碼，也沒有走 Next 圖片最佳化。
  - 透明留白約占四成，因此 `size` 指的是**可見標誌**的大小：容器為 size×size，圖片放大並以可見範圍置中，只有透明像素超出容器，不佔版面、不可點擊。
  - 尺寸：Login 28px，側邊欄、前台頁首、邀請頁 22px（與舊圖示相同），Chainseabase 文字保留。
  - 舊的雙環 SVG 已不在任何品牌位置使用；`Logo` 圖示仍留在 `src/components/icons.tsx`，未刪除。
- **Login 版面**：
  - 桌面（大於 1024px）全視窗左右各半：左側白底，上方置中品牌，登入內容寬 400px 並在左欄中段，無卡片外框；右側為中性純色 `--raised` 空白區，沒有任何內容，兩欄直接相接。
  - 1024px 以下單欄並隱藏右側，左右邊距 24px；矮視窗可捲動，不裁切按鈕與錯誤訊息。
- **元件與文案**：「使用 Google 登入」改用 shadcn Button（`asChild` 包住原連結，滿版）。標題、說明、按鈕文案，以及前後台各自的標題與預設目的地（後台 `/products`、前台 `/`）不變。
- **登入流程與狀態**：OAuth start、callback、session、returnTo 與權限程式未改。新增送出中的「正在前往 Google…」，防止重複點擊；按瀏覽器返回後會恢復可按。取消、過期、失敗的訊息後面加上重試指引。Google 未設定時仍顯示原提示。

修改檔案：`src/features/login.tsx`、新增 `src/components/brand.tsx`（Logo 替換在 `1f4f4de` 之後的 commit，另含 `tests/e2e/helpers.ts` 的 `expectBrandMark` 與 `tests/e2e/sidebar.spec.ts` 等待修正）；Logo 改為使用 `BrandMark` 的有 `src/features/admin/shell.tsx`、`src/features/invite.tsx`、`src/features/portal/portal-shell.tsx`、`src/features/portal/portal-home.tsx`；另有 `src/app/globals.css`（`login-*` 規則）。測試：新增 `tests/ui/login.spec.ts`、`tests/ui/login.tsx`、`tests/ui/login.html`、`tests/ui/next-navigation-stub.ts`、`tests/e2e/login.spec.ts`；修改 `tests/ui/vite.config.ts`、`playwright.config.ts`（平板／手機納入 login）。文件：變更需求狀態、本文件。

驗證（Linux 容器）：
- `tests/ui/login.spec.ts`（mock：以真實 LoginScreen 搭配已設定 Google 的 site 資料，攔截 OAuth start，不連 Google），1440／768／390 各 6 案：
  - 分欄比例、右側空白無內容且為單一中性色、無卡片樣式、內容寬度與置中、手機邊距、無水平溢出、axe。
  - 矮視窗 420px 可捲動到錯誤訊息與按鈕。
  - returnTo 保留於 OAuth start 連結；只送出一次；送出中狀態。
  - 前後台各自的標題與預設目的地。
  - 取消、過期、未驗證、失敗訊息與重試指引；未設定 Google 時沒有按鈕。
  - 鍵盤 Tab 到按鈕且有焦點環，Enter 送出。
- `tests/e2e/login.spec.ts`（實際網站，1440／768／390）：前後台版面、axe、無溢出；測試登入後導向 returnTo；取消訊息。
- Logo（實際網站 1440／768／390）：Login 前後台、後台側邊欄（手機與平板在選單內）、前台頁首、邀請頁的品牌都是這張 PNG，已載入（`naturalWidth` 1800），容器即為設定的可見尺寸，可見範圍置中誤差 0.5px 內，未被容器裁切，且品牌位置沒有殘留的 SVG。隔離 Login 也確認 PNG 經 `publicDir` 載入。
- 版面階段（`43dfd91`）全部檢查：lint、typecheck、build、security:scan（754 檔）、`git diff --check` 皆 exit 0；`npm test` 219 passed；`test:ui` 21 passed（含原 3 個元件測試）；`test:e2e` 128 passed、0 failed。
- Logo 替換後全部檢查：lint、typecheck、build、security:scan（761 檔）、`git diff --check` 皆 exit 0；`npm test` 219 passed；`test:ui` 21 passed；`test:e2e` 第一輪 126 passed、1 failed、1 did not run。
  - 失敗的是 `sidebar.spec` 矮視窗（1440）：測試在後台殼層仍顯示載入中時，就用不會等待的 `allInnerTexts()` 讀取導覽項目，讀到 0 項；失敗截圖中側邊欄已完整顯示。未執行的那 1 項是依賴其他專案的 `empty-last`。
  - 已改為先以 `toHaveCount` 等待 9 項。sidebar 三種尺寸各重複 3 次共 27 passed；完整 `test:e2e` 重跑 128 passed、0 failed。
- 真實 Google 登入未在本環境執行（沒有 Google client）；Google OAuth 的伺服器流程仍由既有整合測試以 fake client 驗證。
