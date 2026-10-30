# 驗收報告

更新日期：2026-10-29。現行驗收規格見 [驗收案例](07-delivery-and-acceptance.md) 與 [WIN 任務](windows-native-deployment.md#開發任務與驗收)。原雲端／匿名前台驗收及 147 單元整合等當時紀錄完整保留在 [歷史報告](history/acceptance-report.md)；不當作本次重跑結果。

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

## 使用者 Windows 11 實機回報（2026-10-29，e4e6e41）

使用者在自己的 Windows 11 主機執行並回報；代理未在該主機執行，與 CI 結果分開。

| 項目 | 使用者回報 |
| --- | --- |
| `Test-ChainseabaseConfig.ps1`（不帶 `-AppDirectory`） | exit=0（`f59e1bb` 修正已確認） |
| `db:migrate`、`db:bootstrap`、`lint`、`typecheck`、`build` | 全部 exit=0 |
| `Initialize-ChainseabaseAvatarStorage.ps1` 與其後的設定／ACL 檢查 | 全部 exit=0 |
| 頭像上傳、停止並重新啟動網站後重新整理 | 仍保留 |
| `C:\ProgramData\Chainseabase\data\avatars` 檔案數 | 1 |
| 網站監聽位址 | 127.0.0.1:3000 |

依規格完成條件，WIN-01 與 WIN-02 已有證據。仍未驗證：主機上的 `npm test` 與 Windows E2E、服務帳號（WIN-03）、排程與備份還原（WIN-05）、重開機自動恢復。

## WIN-04 受邀讀取（2026-10-29，代理執行）

| 檢查 | 平台 | 結果 |
| --- | --- | --- |
| 匿名：8 個前台讀取端點＋產品清單＋搜尋，前台與後台 host | Linux 容器、真實 PostgreSQL 16 | 全部 401，回應不含產品名稱或內容 |
| 未受邀帳號：同一組端點 | 同上 | 產品清單 `[]`；其餘 404，與不存在的 slug 回應相同 |
| 已移除的 tester 與 team（保留 session 驗證資格檢查本身） | 同上 | 404；後台 403；`/me` 為 `role: none` |
| 測試者讀其他產品、撤銷產品資格 | 同上 | 404 與不存在相同；撤銷後下一個請求即 404 |
| 頭像可見範圍與快取 | 同上 | 匿名 401、未受邀 404、其他產品成員 404、受邀共同成員 200；`private, no-cache`、`Vary: Cookie`、ETag，304 前先驗證授權 |
| 通知與前台寫入 | 同上 | 非成員對存在與不存在的產品回應相同 |
| 既有 F09～F15、R14、A02、N05 | 同上 | 改以受邀測試者讀取或改為新規則，斷言保留；`npm test` 18 檔 188 tests 全過 |
| E2E（1440／768／390） | Linux 容器、Chromium | 65 passed；新增匿名「請先登入」、未受邀「尚未受邀」、測試者只見公開項目；修正手機頁首溢出 |
| `npm start`＋設定檔 | Linux 容器（應用目錄副本、獨立資料庫） | 匿名 API 401、未受邀 `[]`／404、頭像標頭、頁面 HTML `no-store` 且不含內容 |

第三方服務仍為 fake。使用者本機驗證（[Windows 設定與安裝](windows-setup.md) 第 8 節）、真實 Google 未受邀帳號流程尚未執行。

## 使用者 Windows 11 實機回報：WIN-04（2026-10-29，6f45809）

使用者在自己的 Windows 11 主機執行並回報；代理未在該主機執行。

| 項目 | 使用者回報 |
| --- | --- |
| 更新到 `6f45809`、安裝與建置 | 通過 |
| 未登入 API：`/public/products`、`/public/products/product-1/feedback`、`?q=` 搜尋 | 三個皆 401 |
| 無痕視窗的前台頁面 | 不顯示公司內容 |
| 後台團隊登入查看 | 正常 |
| 頭像網址在無痕視窗直接存取 | **未實機驗證**（只有容器與 CI 自動化證據） |
| 頭像回應的 `cache-control`／`vary` 標頭 | **未實機驗證** |
| 第二個未受邀 Google 帳號 | **未實機驗證** |

## WIN-03 Windows 服務（2026-10-29，代理執行與 CI）

CI 為 GitHub Actions `windows-2025`（Windows Server、PostgreSQL 17 服務），不是使用者的 Windows 11 主機。push 執行測 `bd35a9c`，pull_request 執行測其與基底的合併提交；兩者皆 success：[push 40840399096](https://github.com/amber-ou/Chainseabase/actions/runs/40840399096)、[pull_request 40840406841](https://github.com/amber-ou/Chainseabase/actions/runs/40840406841)。

| 檢查 | 平台 | 結果 |
| --- | --- | --- |
| 資料庫等待（退避、可重試錯誤、逾時 75、密碼錯誤立即 78、日誌無秘密）、wrapper 消失即結束、參數與設定拒絕 | Linux 容器、真實 PostgreSQL 16 | `npm test` 20 檔 197 tests 全過；看門狗關閉的變異使測試失敗 |
| 安裝與重跑；服務定義（虛擬帳號、延遲自動、相依 PostgreSQL、10／30／60 秒重啟、非 0 結束也重啟、非 Administrators） | CI windows-2025 | PASS |
| 服務帳號實際權限：執行中程序擁有者為 `NT SERVICE\Chainseabase`、health 200（讀到設定檔）、設定檔唯讀、頭像／日誌／`.next\cache` 可寫、release 與 WinSW 唯讀 | 同上 | PASS（證據來自執行中的服務與 SID 權限，不是管理員 PowerShell） |
| 只監聽 loopback；恰一個服務 node 程序 | 同上 | `127.0.0.1:3000` |
| 強制結束 node、強制結束 WinSW | 同上 | 皆自動恢復；WinSW 被終止時 node 自行結束並記錄 `service.wrapper_exited` |
| 資料庫延遲就緒 | 同上 | `db.wait`（ECONNREFUSED）期間 health 非 200，資料庫可連後 `db.ready` 並恢復 |
| 日誌輪替 | 同上 | 8 KB／保留 3：3 個舊檔＋現行檔；無連線字串 |
| 版本切換、故障版本自動回退、切回 | 同上 | 故障版本 exit 1 並回到健康版本；之後切回並再次全檢通過 |
| 解除安裝（兩次） | 同上 | 服務與其權限移除；設定檔雜湊、頭像數量不變；日誌保留；埠釋放 |
| 未登入桌面的重開機恢復 | 使用者主機 | **未驗證**（CI 不能代替；步驟見 [Windows 設定與安裝](windows-setup.md) 9.4） |

## 使用者 Windows 11 實機回報：WIN-03（2026-10-30，繁體中文顯示語言）

使用者在自己的 Windows 11 主機執行並回報；代理未在該主機執行。

| 項目 | 使用者回報 |
| --- | --- |
| `Install-ChainseabaseService.ps1` | exit 0 |
| `Test-ChainseabaseService.ps1` | recovery 一項 FAIL，其餘全部 PASS |
| `sc.exe qfailure Chainseabase` | `RESET_PERIOD (單位: 秒) : 3600`；`RESTART -- 延遲 = 10000／30000／60000 毫秒` |
| 判定 | **設定正確、驗證工具誤判**：舊檢查依英文 `sc.exe` 輸出格式解析，繁中標籤內的冒號使比對失敗 |
| 修正 | 改讀服務設定的結構化數值（登錄 `FailureActions`、`FailureActionsOnNonCrashFailures`），逐項比對安裝設定；缺值或格式不明判 FAIL；繁中輸出列為回歸案例，錯誤設定反例在 CI 實際服務上驗證 |
| 故障恢復、頭像上傳、未登入桌面的重開機恢復 | **未測** |

## 尚未驗證

- Windows 原生完整 lint／typecheck／單元／整合／E2E、PostgreSQL 18 完整回歸與 30 人負載。
- WIN-02 正式 filesystem、WIN-04 受邀資料讀取（包括新版 A02、F09）；舊匿名測試不適用。
- 使用者主機上的設定檔建立、NTFS ACL 與 `config:check`（工具已交付，見 [Windows 設定與安裝](windows-setup.md)）；使用者主機上的 Windows 服務安裝（第 9 節）、無桌面登入重開機恢復、排程與磁碟告警。
- 備份／還原、外部 Tunnel、正式 HTTPS callbacks、Google Calendar 真實讀寫、寄信與長期授權。
- 舊報告中尚未完成的螢幕閱讀器／瀏覽器相容性／人工驗收，仍維持未完成。

## 舊資源

使用者曾回報 Supabase staging migrations／bootstrap／重跑成功及 Vercel Git 斷線。舊資源不等於 Windows 正式環境；保留至遷移驗收完成，不自動刪除。
