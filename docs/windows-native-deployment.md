# Windows 原生部署規格與遷移計畫

決策日期：2026-10-27（Asia/Taipei）。使用者已選 Windows 原生執行，取代 Vercel／Supabase 託管與 WSL2／Docker 自架方案。本文件是本次部署與存取範圍變更的唯一詳細規格；核心功能規則維持原有規格。

## 狀態與證據

- 實作基準：`claude/keen-lamport-4qb974` 的 `82b7641199dea56f08af2028c9a3026060471500`。原 main `18fef8a` 只有早期文件，不能據此重建已完成的應用。
- 主機：使用者回報 Windows 11 專業版 10.0.26200、Core Ultra 7 258V、32 GB RAM、468 GB 可用空間，允許持續開機；需支援公司外使用。
- WSL 沒有已安裝發行版；不再以 WSL、Docker 或 BIOS 虛擬化作為本方案前置條件。
- 使用者已回報 Supabase staging migrations 0001、0002、bootstrap 及重跑成功；這是使用者操作證據，不是本次代理在 Windows 上執行的結果。舊 staging 保留至轉移與還原驗收完成。
- 使用者已回報 Vercel Git 連線中斷；此輪不部署 Vercel。
- 2026-10-28 使用者已回報 Windows 安裝、migrations／bootstrap／重跑、build（退出碼 0）、網站與真實 Google 登入成功。服務、備份、完整回歸與負載尚未驗證；詳見 [驗收報告](acceptance-report.md)。
- 外接備份、管理員安裝權限、公司對外 Tunnel 政策與網域尚待確認。

## 目標架構

瀏覽器 → HTTPS／Cloudflare Tunnel → Windows 上的 Next.js 正式服務 → 同機 PostgreSQL 16 與頭像檔案。

- 一套 Next.js 應用、兩個不同 HTTPS host（後台與受邀成員前台），共用資料庫及服務層。保留一般 Gmail 與 Google Calendar 個人授權。
- Node 使用受支援且符合 package.json 的版本；以使用者已驗證的 Node 24.11.1／npm 10.9.4 為起步證據，不改 lockfile 解決環境問題。安裝時確認官方版本生命週期並記錄實際版本。
- PostgreSQL 使用者已安裝 18.6（舊 CI 為 16），完整相容性待驗證，不自動降版。資料庫採 Windows 服務；應用使用非 superuser 帳號，migration 使用獨立受控權限，資料庫不得向外網開放。
- 應用使用 `npm run build` 產物與正式啟動命令，不以 `npm run dev` 常駐。選用 WinSW 包裝 Node 程序；服務定義、精確命令、固定版本及下載驗證由 WIN-03 實作，不宣稱範本已存在。
- cloudflared 以 Windows 服務運作。Tunnel 是外部流量路徑，不取代應用的權限檢查；確認公司允許此流量路徑。Cloudflare 套餐／Access 資格另確認，不預設 30 人的商業存取一定免費。
- PostgreSQL 與應用只監聽必要的本機介面；不得以路由器轉發 5432 或開放開發埠替代 Tunnel。只有可信代理能傳入 host 轉送資訊。
- 無須固定公網 IP。Google callback 使用穩定 HTTPS 網址，不使用臨時 Tunnel 網址。Google 與邀請寄信仍依賴外部服務；不因自架自動移除 Resend，SMTP 替代需另實作。

## 存取規則變更

原「匿名可讀公開前台」規則停止作為本方案目標。前後台的公司內容與資料 API 均須有效 session 及受邀資格，並維持產品資格、team／tester 與私人 owner 的界線；不能只在前端隱藏內容。首次 bootstrap 團隊資格沿用既有安全流程。

- 登入、OAuth callback、邀請接受所需入口有明確例外，但不得洩漏公司內容；未受邀 Google 帳號不得取得內容。
- 既有公開投影可保留為受邀 tester 可見投影，不代表 tester 可讀 team 內部欄位；不批次將全部 Feedback 改為同一可見性。
- 保留 Roadmap、Schedule、Personal、通知、Calendar ACL 與併發規則。第一版只有頭像儲存，不新增 Feedback 一般附件。
- 未登入／未受邀 API、頭像、直接網址、搜尋、快取與通知均需驗收；移除成員資格後不得保留舊存取權。

## 必要程式調整

目前 LocalAvatarStorage 標記 fake，正式設定要求 Supabase。須分離「實際儲存後端」與「測試替身」，新增正式 filesystem 後端；不能直接允許 production 使用 fake 或開測試登入。

filesystem 必須具備固定根目錄、路徑穿越與 Windows 特殊路徑防護、授權讀取、上傳格式／大小驗證、錯誤可觀測性與原子寫入。儲存路徑與程式版本目錄分離，升級不能刪資料。Supabase adapter 可保留供舊環境使用。

設定模組與 health 必須準確表示實際模式，不再將正式儲存硬綁 Supabase；測試登入與模擬服務禁止進入 staging／production 的規則維持。Windows 同機資料庫與舊 Supabase 的 TLS 設定分開記錄，不以全域停用 TLS 驗證解決連線問題。

## Windows 服務與排程

- 建議分離程式版本、頭像、日誌、秘密與備份暫存目錄；具體 Windows 路徑由安裝腳本定義並在 PowerShell 文件中一致使用。不把密碼寫入 Git、服務命令列或一般日誌。
- 使用最低權限服務帳號及 NTFS ACL。不能依賴互動使用者 PowerShell 的 `$env:` 值；服務與排程要有明確的秘密載入方式，輪替後受控重啟。
- Windows 啟動後，PostgreSQL、網站及 Tunnel 無需登入桌面即可恢復。服務依賴、資料庫就緒重試、失敗重啟、日誌輪替與維護模式均需設定。
- 背景工作由 Windows 工作排程器啟動受保護 runner，預設每五分鐘，禁止重疊執行、設定逾時並記錄失敗；保留 outbox 冪等及去重。
- 使用既有 jobs:run 前先驗證 Windows 環境、秘密載入與進程結束行為。不能把 Bash 的 `VAR=value command` 貼進 PowerShell。
- 主機保持供電、關閉休眠；Windows 更新設定維護時段，不停用安全更新。若為筆電，另驗證闔蓋行為。

## 備份與還原

目前尚無備份裝置。正式承載公司資料前需取得獨立備份位置並完成還原，開發驗證可先進行。

- 建議初始目標：每日備份（RPO 最多 24 小時），RTO 暫定一個工作日；這是待業務接受的目標，不是已驗證承諾。
- PostgreSQL 使用版本相容的 pg_dump custom 格式，不在資料庫運作中直接複製資料目錄。頭像與資料庫採可還原的一致性流程（例如維護視窗停止寫入），保存完整性清單。
- 備份寫入外接碟／NAS 等不同裝置；同一磁碟另一個資料夾不算獨立備份。建議另有輪替離線或加密異地副本，避免主機故障與勒索軟體同時破壞備份。
- 加密金鑰與金鑰版本需另行安全保管；只恢復 token 密文而遺失 TOKEN_ENCRYPTION_KEY 不能恢復日曆授權。秘密備份與資料備份分開控管。
- 排程檢查裝置是否存在、容量、退出碼與備份時效；不得默默寫回系統碟並標成功。建議保留 7 份每日與 4 份每週，容量不足須告警。
- 在隔離 drill 資料庫與隔離頭像路徑還原；驗證權限、資料行數、頭像、Personal 與憑證可解密，禁止測試誤寄信或寫入真實日曆。

## 開發任務與驗收

WIN-01 進行中（使用者已有基本操作證據，設定持久化及完整檢查待做）；WIN-02～07 待開始。文件規格完成不等於功能完成。舊驗收報告保留歷史證據，涉及匿名規則與部署的案例新增／修訂後重跑。

| ID | 交付 | 完成條件 |
| --- | --- | --- |
| WIN-01 | Windows 前置檢查、安裝與版本文件 | 確認管理員權限、Node／npm／Git／PostgreSQL；原生 install、lint、typecheck、build 成功 |
| WIN-02 | 正式 filesystem 儲存與設定 | 路徑防護、權限、重啟持久化測試；正式拒絕 fake 的測試仍通過 |
| WIN-03 | Windows 網站服務、DB 啟動、秘密載入與日誌 | 重開機未登入桌面即恢復；服務故障自動恢復；日誌不含秘密 |
| WIN-04 | 公司內容全面受邀登入控制 | 匿名／未受邀／已移除成員均不能取得內容；tester 與 team 界線不變 |
| WIN-05 | 排程、備份與還原腳本 | 防重疊、離線／容量不足告警、隔離還原成功並記錄耗時與資料損失範圍 |
| WIN-06 | Tunnel、兩個 host、Google 與寄信 | 外網真實登入、邀請與 sandbox 日曆驗收；直接來源埠不公開 |
| WIN-07 | 發布、回退與負載驗收 | 約 30 人測試、斷網恢復、Windows 更新／重啟、舊版本回退與新版 schema 相容性驗證 |

WIN-01 的本機開發隔離環境可先驗證現有程式；不得把 fake 服務或未完成 WIN-04 的頁面透過 Tunnel 對外開放。WIN-02／04 可獨立開發，WIN-06／07 須等前述安全與服務項目就緒。

## 後續開發指令

在既有實作基礎上完成 WIN 任務，不重寫核心產品。先檢查 branch、工作樹及 manifest；不以 main 的舊文件重建 M1–M7。先交付 WIN-01 的版本／安裝規格與可重現的 Windows 檢查，再實作 WIN-02／03／04。若執行環境只有 Linux，可開發及執行可用的測試，但 Windows 服務、重開機、NTFS 與 PowerShell 實測必須標未執行，不能用 Linux 成功替代。

只有完成驗收才能更新任務狀態；真實寄信、日曆修改及對外發布按當次授權執行。不要刪除 Supabase staging、Vercel 專案或既有備份來「完成遷移」。

## 設定與驗收補充（2026-10-28）

Windows 使用者已以 URL 不含密碼＋PGPASSWORD 驗證 migration 成功。WIN-01 需將此流程納入可重現設定，不推斷為 URL 解碼缺陷；拒絕衝突的秘密來源，錯誤只列變數名稱。`.env.example` 保留目前實際支援的變數，新 filesystem 設定要與實作一起加入，不先填虛構可用選項。

正式啟動使用既有 npm scripts 或受支援的 Next.js Node 入口；WinSW 固定明確工作目錄與 Windows 可執行檔，驗證 npm.cmd／程序樹結束與埠釋放，不能照抄 Linux 啟動方式。發布採版本化程式目錄，資料、秘密、日誌與備份獨立。

尚未完成正式儲存和存取權限之前，保留 loopback 開發環境；health 只揭露必要狀態，OAuth／邀請例外不得回傳公司資料。測試應涵蓋 framework 預載、頭像及快取不跨身分洩漏。
