# 開發計畫與進度

更新日期：2026-10-29。以既有實作 `82b7641` 為基礎；不重做 M1–M7。舊任務與測試證據見 [歷史任務紀錄](docs/history/tasks.md)，本輪依 [Windows 原生規格](docs/windows-native-deployment.md) 改造。

## 目前狀態

使用者回報 Windows 11 Pro、Node 24.11.1、PostgreSQL 18.6：套件安裝、migrations 0001／0002、bootstrap 與重跑、build 退出碼 0、本機網站及 Google 真實登入成功。尚未由代理在該 Windows 主機重跑完整檢查，不能標示完整相容性通過。

| ID | 交付 | 依賴 | 狀態 |
| --- | --- | --- | --- |
| DOC-WIN | 現行需求、權限、架構、維運、驗收與 Claude 指令一致化 | 使用者確認原生部署 | 完成（文件）；不代表功能實作完成 |
| WIN-01 | PowerShell 設定持久化／安全載入、版本與安裝文件、Windows 建置和隔離測試 | 現有實作 | 完成（依規格完成條件；證據為使用者 Windows 11 實機回報 2026-10-28／29＋CI Windows Server）；主機未執行 npm test 與 E2E，服務帳號／排程讀取設定檔留待 WIN-03／05 |
| WIN-02 | 正式 filesystem 頭像、provider 設定及路徑防護 | WIN-01 設定契約 | 完成（依規格完成條件；使用者 Windows 11 實機回報 2026-10-29：初始化、ACL、重啟持久化）；服務帳號 Modify 權限（WIN-03）、頭像備份還原（WIN-05）、舊檔清理未做 |
| WIN-03 | Windows 網站／資料庫服務、重開機恢復、權限與日誌 | WIN-01、WIN-02 | 進行中：實作完成；CI `windows-2025`（非使用者主機）完整服務生命週期通過（`bd35a9c`）；未登入桌面的重開機恢復與使用者主機上的服務安裝、頭像上傳待實機 |
| WIN-04 | 全面受邀資料讀取與角色／產品界線 | 既有身分實作 | 進行中：實作與自動化測試完成；使用者實機回報（2026-10-29）通過更新／建置、匿名 API 401、無痕頁面無內容、後台登入；頭像匿名直接存取、快取標頭、第二個未受邀 Google 帳號未實機驗證 |
| WIN-05 | 排程、獨立備份、隔離還原與告警 | WIN-02、WIN-03、備份裝置 | 待開始 |
| WIN-06 | Tunnel、正式 host、Google／寄信／sandbox 日曆 | WIN-02～05、網域與公司政策 | 待開始 |
| WIN-07 | 30 人負載、斷網／重開機／回退與發布 | WIN-01～06 | 待開始 |

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
