# 部署與維運入口

詳細雲端架構、Calendar 授權、CI、備份與監控規格見 [Google Calendar 與雲端部署](docs/06-calendar-and-deployment.md)。本文件是實際操作程序；**目前尚未建立任何雲端環境，以下檢核皆未勾選。**

## 環境分離

| 環境 | 用途 | 資料與第三方服務 |
| --- | --- | --- |
| 開發 | 本機／雲端開發與單元、整合、E2E。 | 本機 PostgreSQL；`CALENDAR_PROVIDER/EMAIL_PROVIDER/STORAGE_PROVIDER=fake`；可開 `E2E_TEST_LOGIN=enabled`。 |
| Staging | 固定網域的整合、OAuth、寄信、日曆實測。部署分支 `staging`，逐步設定見 [Staging 建置清單](docs/staging-setup.md)。 | 獨立 Supabase 專案、測試 Google OAuth client／sandbox 日曆、只寄測試收件人。設定 `APP_ENV=staging` 時與正式相同：拒絕 fake provider 與測試登入；必須明確提供 `DATABASE_URL`、`ADMIN_ORIGIN`、`PORTAL_ORIGIN`（兩個不同的 HTTPS 網站），缺少或不合規即啟動失敗；`db:migrate`／`db:bootstrap` 在 `APP_ENV=staging|production` 下沒有明確連線字串就拒絕執行。 |
| Production | 公司正式使用。 | 正式 Supabase、正式 OAuth client、已驗證寄件網域。設定 `APP_ENV=production`（或 Vercel production）時，應用會**拒絕啟動 fake provider、拒絕測試登入、要求 AUTH_SESSION_SECRET**。 |

Preview 部署不可共用正式 secrets：在 Vercel 把正式變數只設在 Production scope，Preview 指向 staging 或不設定。

## 需要你完成的外部設定

| 外部條件 | 要在哪裡設定 | 影響功能 | 具體步驟 |
| --- | --- | --- | --- |
| EXT-01 Vercel＋Supabase | Vercel 專案 Settings → Environment Variables；Supabase 專案 Settings | 雲端部署、資料庫、頭像 | 1. 建立 Supabase 專案，先停用 Data API（本專案資料表沒有 row-level security），取得 transaction pooler 連線字串給 `DATABASE_URL`、session pooler／direct 連線給 `DIRECT_DATABASE_URL`，兩者都用 `sslmode=verify-full`；資料庫初始化須在自己的電腦執行（雲端工作階段不支援 raw-TCP 資料庫連線）。詳見 [Staging 建置清單](docs/staging-setup.md) 第 2 節。2. Storage 建立 **private** bucket `avatars`，取得 `SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。3. Vercel 匯入 GitHub repo，Framework=Next.js（`vercel.json` 已設定）。4. 綁定兩個網域（例：`admin.example.com`、`feedback.example.com`），設定 `ADMIN_ORIGIN`、`PORTAL_ORIGIN`。 |
| EXT-02 Google OAuth | Google Cloud Console → APIs & Services | Google 登入、Calendar 授權 | 1. 啟用 Google Calendar API。2. OAuth consent screen：依公司 Workspace 選 Internal／External，加入 scopes `openid email profile`、`.../auth/calendar.events`、`.../auth/calendar.calendarlist.readonly`（敏感 scope，External 需驗證）。3. 建立 Web client，Authorized redirect URIs：`https://<admin>/api/v1/auth/google/callback`、`https://<portal>/api/v1/auth/google/callback`、`https://<admin>/api/v1/integrations/google/calendar/callback`。4. 把 `GOOGLE_CLIENT_ID`、`GOOGLE_CLIENT_SECRET` 填入 Vercel。 |
| EXT-03 Resend | Resend Dashboard → Domains／API Keys | Email 邀請 | 1. 新增並驗證寄件網域（DNS SPF／DKIM）。2. 建立 sending-only API key。3. 設定 `RESEND_API_KEY`、`RESEND_FROM_EMAIL`（例：`Chainseabase <no-reply@example.com>`）。 |
| EXT-04 產品日曆 | Google Calendar 設定與共用 | Calendar 讀寫與 ACL 驗收 | 為每個產品建立共用日曆，分享給成員：要編輯者給「變更活動」，只讀者給「查看所有活動詳細資料」。sandbox 另建一份測試日曆，含 writer／reader／未分享帳號。 |
| EXT-05 正式初始化 | Vercel／本機 shell（連 production DB） | 首位團隊、上線 | 設定 `BOOTSTRAP_TEAM_EMAIL`；執行 `npm run db:migrate` 與 `npm run db:bootstrap`；首位團隊以該 Google 帳號登入後取得團隊權限。 |

必填 secrets（只放在 Vercel／CI 加密設定，**不要貼到聊天或 Git**）：`AUTH_SESSION_SECRET`（≥ 32 字元隨機值）、`TOKEN_ENCRYPTION_KEY`（32 bytes base64）、`GOOGLE_CLIENT_SECRET`、`RESEND_API_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`DATABASE_URL`、`DIRECT_DATABASE_URL`、`CRON_SECRET`（Vercel Cron 會以 `Authorization: Bearer $CRON_SECRET` 呼叫工作入口；Vercel 上不要另設 `JOB_RUNNER_SECRET`，兩者並存時以後者為準）。名稱與說明見 [.env.example](.env.example)；staging 的完整變數表、callback URI 與驗證方法見 [Staging 建置清單](docs/staging-setup.md)。

產生隨機值（在自己的終端機執行）：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # AUTH_SESSION_SECRET / CRON_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # TOKEN_ENCRYPTION_KEY
```

## 部署流程（staging → production）

1. PR 觸發 GitHub Actions（`.github/workflows/ci.yml`）：lint、typecheck、單元＋PostgreSQL 整合、migration 重跑、build、秘密掃描、Playwright E2E。全部通過才合併。
2. Migration 先在 staging：`DIRECT_DATABASE_URL=<staging direct> npm run db:migrate`。正式採 expand／contract：只加欄位／表與相容預設，移除舊欄位放下一個版本。有資料風險的 migration 前先建立備份（見下）。
3. 部署 Vercel（staging 網域，分支 `staging`）→ `GET /api/v1/health` 應回 `{"data":{"ok":true,"environment":"staging","providers":{"calendar":"real","email":"real","storage":"real"}}}`（任一 `fake` 即設定錯誤；`real` 只代表已設定真實 adapter，不代表外部服務已驗證）→ 以測試帳號實測 Google 登入、邀請、sandbox 日曆讀寫（[Staging 建置清單](docs/staging-setup.md) 第 7 節）。
4. Vercel Cron 每 5 分鐘呼叫 `/api/v1/jobs/run`（`vercel.json`；Vercel Cron 只在 Production 部署執行，staging 需手動或外部排程）。Hobby 方案只允許每日排程；需要分鐘級需 Pro 方案或外部排程器以同一 bearer secret 呼叫 `POST /api/v1/jobs/run`。請求完成後應用也會立即處理同請求產生的工作，排程只負責重試與補跑。
5. Production：取得當次發布授權後，在 production DB 執行 migration，再 promote 部署；驗證 health、登入、最小日曆讀寫。
6. 回退：Vercel 立即 promote 上一個部署；**不要執行 down migration**，資料依備份與修正 migration 處理。

## 首次上線檢核

- [ ] 雲端專案、網域、HTTPS、區域與方案限制確認（Vercel Cron 頻率、Supabase 備份保留期）。
- [ ] `npm run db:migrate`、`npm run db:bootstrap` 在 staging／production 執行並記錄輸出。
- [ ] Google 登入及 Calendar callback、scopes、consent 條件驗證。
- [ ] 共用日曆分享與 writer／reader／無權限案例驗證（C03／C05–C10／C12–C15）。
- [ ] Resend 寄件網域與 Email 邀請流程驗證。
- [ ] `npm run security:scan` 通過；secrets 只在安全設定中。
- [ ] `/api/v1/jobs/run` 排程可執行、outbox 無積壓、寄信失敗可重試。
- [ ] 備份還原演練（隔離資料庫）、監控與回退方案完成。
- [ ] staging 驗收有實際結果，取得當次正式發布授權。

## 監控與日常檢查

- 日誌為 JSON 行：`api.request`（requestId、方法、路徑、狀態、毫秒）、`api.unhandled`、`job.failed`、`auth.callback`、`calendar.callback`。`log.ts` 會遮蔽含 token／secret／email／body 等鍵名的欄位，不記錄正文與憑證。
- 工作積壓：`npm run jobs:run` 或 `GET /api/v1/jobs/run`（需 bearer secret）回傳 `stats.byState` 與最舊待處理時間；`failed` 數量非零時檢查 `outbox_jobs.last_error`。
- 邀請狀態：User 頁「邀請紀錄」顯示寄送中／已寄出／寄送失敗與錯誤碼（例：`resend_403`、`not_configured`）。
- Calendar：`google_credentials.needs_reauth = true` 的比例代表需要重新授權的人數；成員在 Product 頁會看到「重新連結」。

## 備份、還原與秘密輪替

- Supabase：開啟每日備份（Pro 以上），記錄保留天數與可接受資料損失（RPO）。高風險 migration 前另外 `pg_dump --format=custom` 一份。
- 還原演練（隔離資料庫，名稱需含 `drill`）：

  ```bash
  SOURCE_DATABASE_URL=<備份來源或 staging> TARGET_DATABASE_URL=<…/chainseabase_drill> npm run db:restore-drill
  ```

  腳本比較每張表行數與私人資料摘要（Personal、私人 Tag、Calendar 憑證密文、Feedback revision）。本機已演練一次，Supabase 尚未演練。
- `TOKEN_ENCRYPTION_KEY` 輪替：新金鑰設為 `TOKEN_ENCRYPTION_KEY` 並遞增 `TOKEN_ENCRYPTION_KEY_VERSION`，舊金鑰以 `版本:base64` 放入 `TOKEN_ENCRYPTION_PREVIOUS_KEYS`；新授權用新金鑰，舊密文仍可解。全部重新授權後再移除舊金鑰。
- `AUTH_SESSION_SECRET` 輪替會讓進行中的 OAuth 流程與邀請重寄連結失效（已寄出的邀請 token 雜湊不受影響，但重新寄送會產生新連結）；session 本身以資料庫雜湊保存不受影響。

## 常見故障處理

| 現象 | 優先檢查 |
| --- | --- |
| Google 登入失敗 | callback URI 與 `ADMIN_ORIGIN`／`PORTAL_ORIGIN` 是否一致、consent 測試使用者、`/login?error=` 代碼；不要記錄 code 或 token。 |
| Calendar 無法寫入 | 本人是否已連結且 scopes 完整、Google 日曆分享權限（writer）、`needs_reauth`、ETag 衝突訊息、bindingRevision 是否過期；不借用別人 token。 |
| 日曆送出後顯示「Google 尚未確認」 | 以同一操作重試（相同 Idempotency-Key 會先核對 Google 再決定），不要手動重建活動。 |
| 邀請未收到 | 邀請紀錄的錯誤碼、Resend 網域驗證、`outbox_jobs` 是否卡在 pending／failed。 |
| 通知延遲或重複 | Cron 是否執行、`outbox_jobs` 積壓；`notifications (event_id, recipient_id)` 唯一限制保證不重複。 |
| 公開資料範圍錯誤 | 立即把相關 Feedback 改回內部或取消看板發布；檢查 `loadPublicFeedbackDtos` 白名單與權限測試，再修正與回歸。 |

每次事故保存 request ID（回應標頭 `x-request-id`）、影響範圍、處理與復原時間、修正及回歸結果；不記錄完整私人正文或秘密。

營運驗收見 [O01–O05](docs/07-delivery-and-acceptance.md) 與 [驗收追蹤報告](docs/acceptance-report.md)。
