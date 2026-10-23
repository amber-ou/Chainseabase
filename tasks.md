# 開發計畫與進度

基準：文件包 1.0。狀態用 `完成／待開始／進行中／待外部條件／受阻`；只有交付與驗證證據齊全才能標完成。每次實作更新此檔，不把里程碑計畫當成已交付程式。

## 目前進度

- 完成：文件、M1–M5、M7-01 的程式與自動化驗證；M6 程式與 mock 測試；M7-02 自動化響應式／鍵盤檢查與 taste lint／inspector（公開頁）。
- 待外部條件：真實 Google 登入（EXT-02）、Resend 寄信（EXT-03）、Google 日曆 sandbox 實測（EXT-02、EXT-04）、Vercel／Supabase staging 與正式環境（EXT-01、EXT-05）。
- 最新檢查（2026-10-23，雲端開發容器）：lint、typecheck、build、security scan 通過；Vitest 129 passed／0 failed／0 skipped；Playwright 37 passed／0 failed／0 skipped。完整對照見 [驗收追蹤報告](docs/acceptance-report.md)。
- 下一個可執行步驟：取得 EXT-01／EXT-02 後建立 staging（Vercel＋Supabase），依 [operations.md](operations.md) 設定環境變數，執行 Google 登入與 sandbox 日曆實測（C03／C05–C10／C12–C15），再補 Resend 寄件網域驗證。

## 任務清單

規格縮寫：REQ=[產品需求](docs/01-product-requirements.md)、DATA=[架構資料](docs/02-architecture-and-data.md)、RULE=[互動規則](docs/03-interaction-rules.md)、API=[契約](docs/04-api-contracts.md)、UI=[設計](docs/05-design-system.md)、OPS=[日曆與部署](docs/06-calendar-and-deployment.md)。案例 ID 對照 [驗收文件](docs/07-delivery-and-acceptance.md)。

| ID | 任務與交付 | 依賴 | 規格／驗收 | 狀態 |
| --- | --- | --- | --- | --- |
| DOC-01 | 需求、架構、API、UI、決策與驗收文件。 | — | 文件連結與結構檢查 | 完成 |
| DOC-02 | 根目錄 8 類入口、Claude 規則、任務清單。 | DOC-01 | 閱讀路徑、任務依賴檢查 | 完成 |
| M1-01 | 建立 Next.js／TypeScript、鎖版、基本 shell、runner 與實際啟動／測試指令。 | DOC-02 | DATA、UI；可重現 install/build | 完成 |
| M1-02 | 身分、產品、分類基礎 migration；可重跑 seed 與隔離測試 DB。 | M1-01 | DATA；A01 | 完成 |
| M1-03 | Google 登入、session、首位團隊、後端權限。 | M1-02；EXT-02 實測 | REQ、API；A02、A05–A07 | 待外部條件 |
| M1-04 | Email 邀請、接受、撤銷、角色修改與最後團隊保護。 | M1-03；EXT-03 實測 | REQ、API；A03–A04、A06、A11–A12 | 待外部條件 |
| M1-05 | 產品新增／命名／切換，兩站路由與安全 host。 | M1-03 | REQ、DATA；A08–A09 | 完成 |
| M2-01 | 狀態、類別、Tag 群組、版本單一來源與引用處理。 | M1-02、M1-05 | REQ、DATA；F03–F07 | 完成 |
| M2-02 | Feedback API、公開投影、文字搜尋、併發與冪等。 | M2-01 | REQ、API；F03–F04、F09–F10、F14–F15 | 完成 |
| M2-03 | 建立／編輯 Modal、兩排欄位、連續新增與草稿。 | M2-02 | REQ、UI；F01–F02 | 完成 |
| M2-04 | 普通留言、引用、按讚、投票與測試者互動。 | M2-02、M1-04 | REQ、API；F08、F11–F13 | 完成 |
| M2-05 | User 列表／個人頁、Person tag、個資與頭像。 | M2-01、M2-04 | REQ、DATA；A10、F05 | 完成 |
| M3-01 | Schedule schema、指令 parser、交易與 request 去重。 | M2-02 | RULE、DATA；S02–S10 | 完成 |
| M3-02 | 歷史、移除連動、留言／引用與操作追蹤。 | M3-01、M2-04 | RULE、API；S04–S06、S13–S16 | 完成 |
| M3-03 | 五欄 UI、追加列、草稿原子提交與成功回饋。 | M3-02、M2-03 | RULE、UI；S01、S11–S12、S17 | 完成 |
| M4-01 | 單維度看板、完整唯一欄位、多 Tab 與設定。 | M2-01、M2-02 | RULE、DATA；R01–R05、R09 | 完成 |
| M4-02 | 拖曳／選單移動、rank、排序切換與併發。 | M4-01 | RULE、API；R06–R08、R10–R13 | 完成 |
| M4-03 | 公開狀態看板投影與前台不可寫保護。 | M4-02、M2-02 | REQ、API；R14、F09–F10 | 完成 |
| M5-01 | 責任清單、私人 views／columns／placements、Tag 隔離。 | M2-05、M2-02 | RULE、DATA；P01–P02、P05–P07 | 完成 |
| M5-02 | Personal UI、負責人切換、拖曳、自動儲存與失敗回復。 | M5-01 | RULE、UI；P03–P04、P08 | 完成 |
| M5-03 | Domain events／outbox、通知接收者、去重與浮層。 | M2-04、M2-05、M3-02 | REQ、RULE；N01–N06、O02 | 完成 |
| M6-01 | 個別 Calendar 授權、token 加密／刷新、日曆 ACL 與綁定。 | M1-03、M1-05；EXT-02、EXT-04 實測 | OPS、API；C01–C04、C15、C17 | 待外部條件 |
| M6-02 | Google adapter、單次／全天 CRUD、ETag 與 mutation 核對。 | M6-01 | OPS、API；C05–C07、C12–C14、C18 | 待外部條件 |
| M6-03 | 重複活動本次／整系列、例外與不支援型別保護。 | M6-02 | OPS；C08–C11 | 待外部條件 |
| M6-04 | Dashboard 日曆、編輯 Modal、拖曳改期、分頁與刷新。 | M6-03、M2-02 | UI、OPS；C05–C06、C16、C18 | 待外部條件 |
| M7-01 | 公開前台完整流程與匿名／測試／團隊 E2E。 | M2-04、M4-03、M5-03 | REQ、API；F08–F13、R14 | 完成 |
| M7-02 | 響應式、鍵盤、focus、狀態、taste inspector 與截圖修正。 | M3-03、M4-02、M5-02、M6-04、M7-01 | UI；V01–V04 | 進行中 |
| M8-01 | CI、staging 隔離、secret 管理、工作程序與觀測。 | M1-01、M5-03；EXT-01、EXT-03 | OPS；O01–O02、O04 | 進行中 |
| M8-02 | 備份／復原演練、約 30 人負載與相容 migration 驗證。 | M8-01、M7-02 | OPS；O03、O05 | 進行中 |
| M8-03 | 完整驗收報告、發布／回退計畫與正式部署。 | M8-02；全部外部條件、實際發布授權 | 全部適用驗收 | 待外部條件 |

依賴代表交付先後，不代表所有程式必須等待第三方帳號；Calendar／Email 可先實作 adapter 與隔離測試。外部實測未完成時，不把整合任務標成完成。

## 外部條件與待提供資料

| ID | 內容 | 影響 | 狀態 |
| --- | --- | --- | --- |
| EXT-01 | Vercel／Supabase 專案、區域、正式與 staging 網域。 | 真實雲端建置與部署。 | 待外部條件 |
| EXT-02 | Google Cloud OAuth client、consent 設定與 callbacks。 | 登入／Calendar 真實整合。 | 待外部條件 |
| EXT-03 | Resend 已驗證寄件網域與測試寄件資格。 | 邀請信實測。 | 待外部條件 |
| EXT-04 | sandbox／正式產品日曆、成員分享權限。 | Calendar ACL 與讀寫驗收。 | 待外部條件 |
| EXT-05 | 指定首位團隊 Email、正式 secret 注入、備份方案及發布授權。 | 正式初始化與上線。 | 待外部條件 |

不要在此表填秘密值；只記是否已配置、配置位置名稱與驗證結果。實際操作前先檢查已提供的設定，避免重複向使用者索取。

## 任務更新與完成條件

每個進行中／完成任務需記錄負責人、PR／commit（若有）、實際檢查命令與結果、未完成項目與阻擋原因。用以下格式追加，不填虛構結果：

```text
任務：
狀態：
負責人：
交付檔案／PR／commit：
實際檢查與結果：
未完成或阻擋：
```

沒有固定工期承諾；在 M1 完成、第三方條件確認後，再依實際進度估算。需求變更先記錄決策，再更新受影響任務與驗收。

## 任務紀錄

以下紀錄的「實際檢查」均在 2026-10-23、雲端開發容器（Node 22.22.0、PostgreSQL 16.15、Chromium）於儲存庫根目錄執行。第三方皆為 fake／本機替身，除非另有說明。

```text
任務：M1-01 專案骨架、鎖版、runner 與指令
狀態：完成
負責人：Claude Code
交付檔案／commit：package.json、package-lock.json、tsconfig.json、next.config.ts、eslint.config.mjs、vitest.config.ts、playwright.config.ts、.env.example、README.md、CLAUDE.md（commit 5c9fdee 起）
實際檢查與結果：npm ci、npm run lint（0 error）、npm run typecheck、npm run build（Next.js 16.4.2）皆通過
未完成或阻擋：無
```

```text
任務：M1-02 身分／產品／分類 migration、可重跑初始化、隔離測試 DB
狀態：完成
負責人：Claude Code
交付檔案：db/migrations/0001_init.sql、scripts/migrate*.ts、scripts/bootstrap*.ts、scripts/seed-dev.ts、tests/helpers/*
實際檢查與結果：npm run db:migrate 連續兩次（第二次無變更）；db:bootstrap 連續與併發執行只產生一份產品1（A01 通過）；測試 DB 每次重建 schema
未完成或阻擋：無
```

```text
任務：M1-03 Google 登入、session、首位團隊、後端權限
狀態：待外部條件（程式與 mock 測試完成）
負責人：Claude Code
交付檔案：src/modules/identity/auth.ts、src/server/adapters/google-oauth.ts、src/server/session.ts、src/server/authz.ts、src/server/http.ts
實際檢查與結果：identity.test.ts 15 passed（OAuth state/PKCE/nonce 流程以 fake client、bootstrap Email 只授權一次、未驗證 Email 拒絕、returnTo 白名單、CSRF Origin 檢查）；E2E 權限畫面通過
未完成或阻擋：EXT-02（Google OAuth client 與 callback URI）尚未提供，真實 Google 登入未實測
```

```text
任務：M1-04 Email 邀請、接受、撤銷、角色與最後團隊保護
狀態：待外部條件（程式與 mock 測試完成）
交付檔案：src/modules/identity/invitations.ts、users.ts、src/server/adapters/email.ts、src/server/jobs.ts
實際檢查與結果：A03、A04、A06、A11、A12 整合測試通過（fake 寄信）；UI：User 頁邀請、重寄、撤銷、角色變更、移除
未完成或阻擋：EXT-03（Resend 寄件網域）未提供，真實寄信未實測
```

```text
任務：M1-05 產品新增／命名／切換、兩站路由與安全 host
狀態：完成
交付檔案：src/modules/products/service.ts、src/proxy.ts、src/features/admin/shell.tsx、src/features/dashboard/dashboard.tsx
實際檢查與結果：A08（伺服器部分）、A09 通過；E2E 驗證前台 host 不提供後台頁、後台 host 不提供前台頁（404）
未完成或阻擋：A08 前端遲到回應丟棄為程式審查，未有自動化慢回應測試
```

```text
任務：M2-01～M2-05 分類、Feedback、Modal、留言／投票、User／Person tag／頭像
狀態：完成
交付檔案：src/modules/products/taxonomy.ts、src/modules/feedback/*、src/features/feedback/*、src/features/users/*、src/features/settings/*、src/modules/identity/avatar.ts
實際檢查與結果：feedback.test.ts 17 passed（F01–F15）、avatar.test.ts 2 passed；E2E F01/F02/F08/F12/F15 通過
未完成或阻擋：頭像在 Supabase Storage 的真實上傳待 EXT-01（目前以本機儲存驗證）
```

```text
任務：M3-01～M3-03 Schedule
狀態：完成
交付檔案：src/modules/schedule/*、src/features/schedule/schedule-tab.tsx
實際檢查與結果：schedule.test.ts 18 passed（S01–S17，含注入 DB 失敗 rollback 與併發 revision）、tests/unit/schedule.test.ts 6 passed；E2E 草稿、即時指令、清空、歷史移除、取消草稿通過
未完成或阻擋：無
```

```text
任務：M4-01～M4-03 Roadmap
狀態：完成
交付檔案：src/modules/roadmap/*、src/features/roadmap/*
實際檢查與結果：roadmap.test.ts 14 passed（R01–R14）、property-based 不變量 6 passed；E2E 鍵盤選單移動只改狀態
未完成或阻擋：無
```

```text
任務：M5-01～M5-03 Personal 與通知
狀態：完成
交付檔案：src/modules/personal/*、src/modules/notifications/service.ts、src/server/events.ts、src/server/jobs.ts、src/features/personal/personal-page.tsx
實際檢查與結果：personal-notifications.test.ts 14 passed（P01–P08、N01–N06）、operations.test.ts O02 通過；E2E 自動儲存與私人欄位
未完成或阻擋：無
```

```text
任務：M6-01～M6-04 Google Calendar
狀態：待外部條件（程式與 mock 測試完成）
交付檔案：src/modules/calendar/*、src/server/adapters/google-calendar.ts、src/features/calendar/calendar.tsx
實際檢查與結果：calendar.test.ts 20 passed、tests/unit/calendar.test.ts 6 passed（皆為 FakeCalendarApi）；E2E 以模擬日曆連結、綁定、新增、編輯
未完成或阻擋：EXT-02、EXT-04；C03／C05–C10／C12–C15 需 sandbox 日曆實測；C10 需記錄 Google 對系列例外的實際行為
```

```text
任務：M7-01 公開前台與匿名／測試／團隊 E2E
狀態：完成
交付檔案：src/features/portal/*、tests/e2e/portal.spec.ts
實際檢查與結果：Playwright portal.spec 5 passed（匿名只見公開、受邀測試者新增／投票／留言、未受邀提示、host 分離）
未完成或阻擋：無
```

```text
任務：M7-02 響應式、鍵盤、狀態、taste inspector
狀態：進行中
交付檔案：src/app/globals.css、tests/e2e/responsive.spec.ts
實際檢查與結果：responsive.spec 在 1440／768／390 共 24 passed（無整頁溢出、手機選單、Schedule 五欄容器捲動、Modal 焦點循環）；taste lint 0 FAIL／0 WARN；inspector 前台 Feedback／Roadmap／登入頁 0 FAIL
未完成或阻擋：inspector 無法帶入登入 session，後台頁僅以 Playwright 截圖人工檢查；螢幕閱讀器實機測試未執行
```

```text
任務：M8-01 CI、staging 隔離、secret 管理、工作程序與觀測
狀態：進行中
交付檔案：.github/workflows/ci.yml、vercel.json、scripts/check-secrets.ts、src/server/log.ts、/api/v1/jobs/run、/api/v1/health
實際檢查與結果：本機執行 CI 全部步驟通過；production 設定拒絕 fake provider 與測試登入（單元測試）
未完成或阻擋：EXT-01 staging／production 專案與 secrets 注入；GitHub Actions 首次執行結果見推送後的 CI
```

```text
任務：M8-02 備份復原演練、負載、相容 migration
狀態：進行中
交付檔案：scripts/restore-drill.ts、scripts/load-test.ts
實際檢查與結果：本機 pg_dump→pg_restore 演練一致（41 表）；本機 30 人 × 30 秒負載 p95 ≤ 237 ms，見 docs/acceptance-report.md
未完成或阻擋：Supabase 正式備份還原與 staging 負載需 EXT-01
```
