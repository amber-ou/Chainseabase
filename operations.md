# Windows 原生維運操作

現行架構與完成條件見 [Windows 原生部署規格](docs/windows-native-deployment.md)。本文件是操作順序，不代表服務安裝腳本已交付。舊 Vercel／Supabase 操作移至 [歷史快照](docs/history/operations.md)。

## 環境隔離

| 環境 | 資料與用途 |
| --- | --- |
| Windows development | `chainseabase_dev`，APP_ENV=development，僅 loopback。使用者已完成基本操作與登入驗證。 |
| Windows staging | 獨立資料庫、儲存路徑、服務、埠、秘密與 Google sandbox；正式儲存後端實作後才使用 strict staging。 |
| Production | 獨立資料庫與非 superuser runtime 帳號、HTTPS host、備份與服務；不可沿用有 schema 所有權的開發帳號。 |
| Test／drill | 名稱須符合既有 test／drill 防呆；不可指向公司正式資料。 |

WIN-02 已完成（使用者實機回報）；WIN-04 已實作受邀讀取（匿名 401、無資格 404，含頭像與搜尋），待使用者本機驗證。WIN-03 網站服務已實作（虛擬服務帳號、只監聽 127.0.0.1，操作見 [Windows 設定與安裝](docs/windows-setup.md) 第 9 節），重開機恢復待主機驗證。在 WIN-06 Tunnel 與當次授權前，網站仍只在本機使用，不得對外開放。正式環境維持禁止 fake／測試登入，不以 APP_ENV=development 規避防護。

## 設定保存（WIN-01）

PowerShell `$env:` 只作用於目前進程與子進程，不能當作服務持久設定。已實作單一載入器 `scripts/config/load-config.mjs`：網站（`npm run dev`／`npm start` 以 Node `--import` 預載）、CLI（`db:migrate`、`db:bootstrap`、`jobs:run`、`db:seed-dev`、`config:check`）在讀取環境變數之前以相同規則載入。逐步操作見 [Windows 設定與安裝](docs/windows-setup.md)。

- 來源：`CHAINSEABASE_CONFIG_FILE` 指向的受 NTFS ACL 保護設定檔（staging／production 唯一來源）；development 無設定檔時讀 `.env.local`（與 `next dev` 相同）；程序環境只能與檔案同值。
- 拒絕：同一變數多個來源值不同、strict 環境的變數只在程序環境、設定檔旁仍有 `.env*`、URL 內密碼與 `PGPASSWORD` 不同、未知或重複變數。結束代碼 78，只列變數名稱。
- PowerShell 工具（`scripts/windows/`）：`Test-ChainseabasePrerequisites.ps1`、`New-ChainseabaseConfig.ps1`（建立／匯入、以 SID 設定 ACL、只在缺少時產生持久秘密、可存電腦層級路徑）、`Set-ChainseabaseConfigValue.ps1`（安全輸入、原地寫入）、`Test-ChainseabaseConfig.ps1`（ACL 與 `config:check`）。
- `npm run config:check`：列出每個變數的來源與 provider 模式，再執行應用設定驗證；不顯示值。
- migration 讀取程式所在位置的 `db/migrations`（不依賴工作目錄）；檢查碼不受 CRLF／LF 影響，真正的內容變更仍會被拒絕。
- 尚未納入：`db:restore-drill` 與 `load-test` 仍使用各自明確的來源／目標變數；WIN-03 服務帳號讀取設定檔已在 CI 驗證（執行中服務的 health 與 SID 權限）；WIN-05 排程與備份讀取同一設定檔時再驗證。

| 設定 | 用途 |
| --- | --- |
| APP_ENV | development／staging／production，僅本機驗證使用 development |
| DATABASE_URL／DIRECT_DATABASE_URL | 分別供 runtime／migration；本機已驗證 URL 不含密碼、由 PGPASSWORD 提供密碼。正式需區分權限，不得在命令列列出秘密 |
| PGPASSWORD | 驅動與 PostgreSQL 工具可用的秘密來源；避免與 URL 內不同密碼並存，不印出值 |
| ADMIN_ORIGIN／PORTAL_ORIGIN | 本機 localhost／127.0.0.1，正式兩個不同 HTTPS host；禁止任意外部 Host |
| GOOGLE_CLIENT_ID／GOOGLE_CLIENT_SECRET | 已建立本機 client；正式 callback 另驗證 |
| AUTH_SESSION_SECRET | 持久隨機值；輪替會影響登入，不依賴開發預設值 |
| TOKEN_ENCRYPTION_KEY／版本及舊金鑰 | 日曆憑證加密與還原，不能每次啟動重生 |
| BOOTSTRAP_TEAM_EMAIL | 既有首位資格流程；從安全設定取得，不將個人信箱硬編碼到腳本 |
| RESEND_API_KEY／RESEND_FROM_EMAIL | 保留現有寄信 adapter，尚待寄件網域及真實驗收 |
| JOB_RUNNER_SECRET／CRON_SECRET | 只配置所選 runner 必要秘密；兩者並存時遵守既有優先序 |
| STORAGE_PROVIDER／AVATAR_STORAGE_DIR | `filesystem`＋應用目錄以外的固定本機目錄（預設 `C:\ProgramData\Chainseabase\data\avatars`，由 `Initialize-ChainseabaseAvatarStorage.ps1` 建立並設定 ACL）；`supabase`（舊名 `real`）只供舊環境；`fake` 為測試替身，staging／production 拒絕 |

Supabase 相關變數只保留給舊環境或舊 adapter。本機 Windows 不使用 Supabase CA；不能全域停用 TLS 驗證，對外 Google／寄信／Tunnel 維持驗證。

## 安裝與發布順序

1. 保留目前開發資料與工作樹；記錄 Node 24.11.1、安裝時使用 npm 10.9.4、PostgreSQL 18.6 等使用者回報版本。檢查各元件修補與支援狀態，不因舊 CI 用 PG16 就自動降版或刪資料。
2. 依 [Windows 設定與安裝](docs/windows-setup.md) 完成 WIN-01：前置檢查、受保護設定檔、`config:check`、migrate／bootstrap、lint／typecheck／build，回報輸出與退出碼。CI 另在 Windows Server 執行器與 Node 24＋PostgreSQL 18（Linux）跑同一組檢查，但不取代主機實測。
3. 依 [Windows 設定與安裝](docs/windows-setup.md) 第 7 節建立頭像目錄（WIN-02），完成 WIN-04 受邀資料權限，沿用角色／產品／私人 owner 保護。
4. 交付並驗證 WinSW 網站、PostgreSQL 與 cloudflared 服務，服務帳號最小權限、依賴就緒重試、失敗恢復及日誌輪替。版本化安裝與解除安裝腳本不得刪資料／秘密。
5. 設定工作排程器與獨立備份裝置；斷開備份裝置時應告警，於隔離環境實際還原。
6. 確認公司允許 Tunnel、固定網域、Google External 測試帳號／發布條件與寄件網域後，執行外部 sandbox 驗收。
7. migration 前備份，在 staging 驗證相容變更；正式發布依當次授權。回退程式不等於回退資料庫，禁止盲目 down migration。

原生部署不是保持 PowerShell 視窗開著。正式驗收須包含 Windows 重開機、未登入桌面、服務／網路中斷後自動恢復及約 30 人負載。

## 尚待完成

沒有 Windows 服務、獨立備份、還原、外網存取、Google 日曆或真實寄信的完成證據。檢查清單與證據見 [tasks.md](tasks.md) 及 [驗收報告](docs/acceptance-report.md)。
