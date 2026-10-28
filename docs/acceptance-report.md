# 驗收報告

更新日期：2026-10-28。現行驗收規格見 [驗收案例](07-delivery-and-acceptance.md) 與 [WIN 任務](windows-native-deployment.md#開發任務與驗收)。原雲端／匿名前台驗收及 147 單元整合等當時紀錄完整保留在 [歷史報告](history/acceptance-report.md)；不當作本次重跑結果。

## Windows 實機：使用者回報

本表來自本次對話中的輸出與使用者確認；代理沒有直接連入 Windows。驗證日期記錄日為 2026-10-28，跨日操作不推測精確執行時間。

| 項目 | 證據 | 範圍 |
| --- | --- | --- |
| 平台 | Windows 11 Pro 10.0.26200、Core Ultra 7 258V、32 GB RAM | 主機資訊回報 |
| 相依安裝 | Node 24.11.1；系統 npm 11.6.4；依指令以 npm 10.9.4 執行 ci，退出碼 0 | 不等於完整依賴相容性測試 |
| PostgreSQL | psql 回報 18.6、唯讀查詢成功 | 本機資料庫，不是 Supabase |
| Migration | Applied: 0001_init.sql, 0002_roadmap_placement_revision.sql；退出碼 0 | 本機 development |
| 初始化／重跑 | 使用者回報 migration 重跑及 bootstrap 兩次均成功 | 預設產品與首位資格；不重設既有資料 |
| Build | 使用者貼出 Next.js 結尾與退出碼 0 | Windows 正式建置流程 |
| 網站啟動 | 本機登入畫面截圖 | localhost／127.0.0.1，APP_ENV=development |
| Google 登入 | 使用者確認成功進入後台 | 真實本機登入；日曆與前台登入未據此驗證 |

連線字串嘗試曾出現密碼驗證失敗。最後成功組合是無密碼的本機 URL＋PGPASSWORD；只能記為設定差異排除成功，沒有證據證明驅動程式 URL 解碼有缺陷。秘密不存入本報告。

## WIN-01 設定載入（2026-10-28，代理執行）

| 檢查 | 平台 | 結果 |
| --- | --- | --- |
| 載入器單元測試（來源優先序、衝突、strict 只讀設定檔、Windows 路徑、POSIX 權限、URL 密碼與 PGPASSWORD、`.env.example` 變數一致） | Linux 容器 | 14 passed（`tests/unit/load-config.test.ts`）；移除衝突檢查或 migrate 的預載時對應測試失敗 |
| 真實預載與 CLI：`node --import` 預載、`db:migrate` 以「URL 無密碼＋設定檔 PGPASSWORD」連線 | Linux 容器、真實 PostgreSQL 16 | passed（子行程測試，輸出只含目標主機與結果） |
| migration 檢查碼 CRLF／LF 相容、內容變更仍拒絕 | Linux 容器 | 3 passed（`tests/unit/migrate-lib.test.ts`） |
| 全套 `npm test` | Linux 容器、PostgreSQL 16 | 16 檔 164 tests：164 passed、0 failed、0 skipped |
| `npm run test:e2e` | Linux 容器、Chromium | 64 passed、0 failed、0 skipped |
| lint／typecheck／build／security:scan | Linux 容器 | 退出碼皆 0 |
| `npm start` 經載入器 | Linux 容器 | 繼承 `APP_ENV=staging` 時 exit 78 拒絕；development 時 health 200、只監聽 127.0.0.1 |
| PowerShell 工具、NTFS ACL 正反測試、Windows 上 migrate／bootstrap 與 npm test | GitHub Actions `windows-2025`（Windows Server，非使用者主機） | 結果見 PR 的 `win-native` 檢查 |
| Node 24.11.1＋PostgreSQL 18 相容性 | GitHub Actions Linux | 結果見 PR 的 `pg18-node24` 檢查；Windows 上的 PostgreSQL 18.6 仍待主機實測 |

所有第三方服務在上述測試中皆為 fake；Windows 執行器不是使用者的 Windows 11 主機，不能據此標示 WIN-01 在主機上完成。

## WIN-01 使用者 Windows 11 實機回報（2026-10-28）

以下為使用者在自己的 Windows 11 主機執行並回報的結果，代理未在該主機執行；與上方容器及 CI 結果分開記錄，不代表完整 Windows 測試通過。

| 項目 | 使用者回報 |
| --- | --- |
| PostgreSQL 監聽位址 | 改為只監聽 localhost 後，`Test-ChainseabasePrerequisites.ps1` 通過 |
| 受保護設定檔 | `New-ChainseabaseConfig.ps1` 建立成功；`Test-ChainseabaseConfig.ps1` 的 NTFS ACL 與 `config:check` 通過（需明確傳入 `-AppDirectory`，見下） |
| migration | 使用設定檔執行，顯示 `Database schema is up to date.` |
| 網站與登入 | `npm start` 啟動，Google 重新登入成功（真實 Google OAuth，本機 callback） |
| 問題 | `Test-ChainseabaseConfig.ps1` 第 31 行參數預設值的 `$PSScriptRoot` 為空字串，`Split-Path` 失敗；明確傳入 `-AppDirectory` 後通過 |

修正：預設應用目錄改在腳本本體計算（`$PSScriptRoot` → 腳本路徑 → 目前目錄），並確認目錄含 `package.json` 與 `scripts\config\load-config.mjs`，否則以 exit 1 說明需傳入 `-AppDirectory`。CI `win-native` 新增在 PowerShell 7 與 5.1 下重現空 `$PSScriptRoot`（以 script block 執行腳本內容）、從其他目錄執行與明確 `-AppDirectory` 的檢查。修正尚待使用者在主機以不帶 `-AppDirectory` 的指令重新確認。

未回報（尚待主機執行）：各步驟的 `exit=` 值、`db:bootstrap` 重跑、lint／typecheck／build、主機上的 `npm test`、`npm start` 只監聽 127.0.0.1 的確認。

## WIN-02 filesystem 頭像（2026-10-28，代理執行）

| 檢查 | 平台 | 結果 |
| --- | --- | --- |
| 設定：staging 接受 filesystem 且不需 Supabase；仍拒絕 fake；AVATAR_STORAGE_DIR 須為絕對本機路徑且在應用目錄外（Windows 拒絕 UNC／裝置路徑）；錯誤不含路徑；舊值 real＝supabase | Linux 容器 | `tests/unit/config.test.ts` 新增 6 tests 通過 |
| 儲存：重啟（新實例）持久化、物件路徑白名單（穿越、`CON`／`NUL`、ADS、尾端點／空白、大小寫）、根目錄不存在時明確失敗、連結／junction 拒絕、原子寫入不留暫存檔、讀取不見半寫入檔 | Linux 容器 | `tests/unit/storage-filesystem.test.ts` 6 tests 通過；放寬白名單時穿越測試失敗 |
| API：上傳存於資料庫路徑並於重啟後提供；根目錄不可用時 503 且保留原頭像；遭竄改的資料庫路徑回 404；無 content-length 的 64 MB 串流在 2 MB 後中止 | Linux 容器、真實 PostgreSQL 16 | `tests/integration/avatar.test.ts` 新增 4 tests 通過 |
| 全套 `npm test`、lint、typecheck、build、security:scan | Linux 容器 | 17 檔 180 tests 全過；其餘退出碼皆 0 |
| `npm start`＋設定檔：上傳、停止、重新啟動後頭像位元組相同；health 回報 `storageBackend: filesystem` | Linux 容器（應用目錄副本、獨立資料庫） | passed |
| PowerShell 建立／匯入／ACL、npm start 重啟持久化、Windows junction 防護 | GitHub Actions `windows-2025`（非使用者主機） | 結果見 PR 的 `win-native` 檢查 |

第三方服務仍為 fake；頭像為真實本機檔案系統。使用者 Windows 11 主機尚未執行第 7 節；WIN-04（頭像需登入、快取 private）未開始。

## 尚未驗證

- Windows 原生完整 lint／typecheck／單元／整合／E2E、PostgreSQL 18 完整回歸與 30 人負載。
- WIN-02 正式 filesystem、WIN-04 受邀資料讀取（包括新版 A02、F09）；舊匿名測試不適用。
- 使用者主機上的設定檔建立、NTFS ACL 與 `config:check`（工具已交付，見 [Windows 設定與安裝](windows-setup.md)）；Windows 服務、無桌面登入重開機恢復、排程與磁碟告警。
- 備份／還原、外部 Tunnel、正式 HTTPS callbacks、Google Calendar 真實讀寫、寄信與長期授權。
- 舊報告中尚未完成的螢幕閱讀器／瀏覽器相容性／人工驗收，仍維持未完成。

## 舊資源

使用者曾回報 Supabase staging migrations／bootstrap／重跑成功及 Vercel Git 斷線。舊資源不等於 Windows 正式環境；保留至遷移驗收完成，不自動刪除。
