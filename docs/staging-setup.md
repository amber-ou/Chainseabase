# Staging 建置清單

用來把目前的實作部署到**隔離的 staging**，以真實 Google OAuth／Calendar、Resend、Supabase 實測。本文件只列操作步驟與檢查方法；**所有秘密只填在各平台的加密設定或你自己的終端機，不要貼到聊天、Issue、PR 或 Git。**正式環境另需當次發布授權，不在本清單範圍。

## 0. 目前狀態（2026-10-23 檢查）

| 項目 | 已在儲存庫 | 尚缺（需要你在外部平台完成） |
| --- | --- | --- |
| Vercel | `vercel.json`（Next.js、`npm ci`、`npm run build`、Cron `/api/v1/jobs/run` 每 5 分鐘） | Vercel 專案、staging 網域、環境變數 |
| Supabase | `db/migrations/*.sql`（`npm run db:migrate` 冪等）、`npm run db:bootstrap`（無示範資料）；連線已設 `prepare: false` 可用 transaction pooler | staging 專案、連線字串、private bucket |
| Google | OAuth 流程與 callback 路由已實作；scopes 見下 | OAuth client、consent screen、sandbox 日曆與測試帳號 |
| Resend | 寄送 adapter、失敗重試、邀請紀錄狀態 | 已驗證寄件網域、API key |
| 環境防呆 | `APP_ENV=staging` 與正式相同防呆：拒絕 fake provider、拒絕測試登入、缺必要變數直接啟動失敗（只列名稱）；`/api/v1/health` 回報 `environment` 與各 provider 是 `real` 或 `fake` | — |
| CI | `.github/workflows/ci.yml`（PR 與 `claude/**` 推送） | — |

## 1. 部署分支與網域

| 環境 | Git 分支 | Vercel 環境 | 網域（範例，換成公司網域） |
| --- | --- | --- | --- |
| Staging | **`staging`**（由 `claude/keen-lamport-4qb974` 建立；PR 合併後改由 `main` 快轉更新） | Preview（只對 `staging` 分支設定變數） | 後台 `staging-admin.example.com`、前台 `staging-feedback.example.com` |
| Production | `main` | Production | 尚未建立；需當次發布授權 |

建立 staging 分支（在你自己的 clone 執行）：

```bash
git fetch origin claude/keen-lamport-4qb974
git push origin origin/claude/keen-lamport-4qb974:refs/heads/staging
```

> Vercel 匯入儲存庫後，`main` 預設就是 Production Branch，**合併 PR 會自動觸發 production 部署**。在取得正式發布授權前，請到 Vercel → Settings → Git 暫停 production 自動部署（或先不要匯入 `main` 以外的設定），避免未經授權的正式發布。Production 若缺正式變數，應用會在啟動時拒絕執行。

## 2. Supabase（staging 專用專案）

1. Supabase Dashboard → New project：名稱 `chainseabase-staging`，區域 `ap-northeast-1`（東京）或 `ap-southeast-1`（新加坡），與 Vercel Functions 區域一致。資料庫密碼存在密碼管理工具。
2. Project Settings → Database → Connection string：
   - **Transaction pooler**（port 6543）→ `DATABASE_URL`，結尾加 `?sslmode=require`。
   - **Direct connection**（port 5432；若網路只支援 IPv4，改用 Session pooler）→ `DIRECT_DATABASE_URL`，只給 migration 使用。
3. Storage → New bucket：名稱 `avatars`，**Public 關閉**（private）。Project Settings → API：取得 Project URL → `SUPABASE_URL`；`service_role` key → `SUPABASE_SERVICE_ROLE_KEY`（只放伺服器端，不可加 `NEXT_PUBLIC_`）。
4. Database → Backups：確認方案的每日備份與保留天數，記錄在 [operations.md](../operations.md)。
5. 在你自己的終端機初始化（不要把連線字串貼到聊天）：

   ```bash
   export DIRECT_DATABASE_URL='<staging direct 連線字串>'
   npm ci
   npm run db:migrate          # 冪等，可重跑；輸出記錄到驗收報告
   BOOTSTRAP_TEAM_EMAIL='<staging 首位團隊測試帳號>' DATABASE_URL="$DIRECT_DATABASE_URL" npm run db:bootstrap
   ```

## 3. Google Cloud（staging 專用 OAuth client）

1. Google Cloud Console 建立或選擇專案（建議 `chainseabase-staging`，與正式分開）。APIs & Services → Library → 啟用 **Google Calendar API**。
2. OAuth consent screen：
   - 公司為 Google Workspace 且只給內部帳號 → User type **Internal**。
   - 否則 **External**，Publishing status 保持 **Testing**，在 Test users 加入所有 staging 測試帳號（Testing 狀態下 refresh token 7 天過期，實測 C15 時要注意）。
   - Scopes：`openid`、`email`、`profile`、`https://www.googleapis.com/auth/calendar.events`、`https://www.googleapis.com/auth/calendar.calendarlist.readonly`。
3. Credentials → Create OAuth client ID → **Web application**，Authorized redirect URIs **完全照抄**（含 `https`、無結尾斜線）：

   ```text
   https://staging-admin.example.com/api/v1/auth/google/callback
   https://staging-feedback.example.com/api/v1/auth/google/callback
   https://staging-admin.example.com/api/v1/integrations/google/calendar/callback
   ```

   Authorized JavaScript origins 可留空（伺服器端授權碼流程）。Client ID → `GOOGLE_CLIENT_ID`；Client secret → `GOOGLE_CLIENT_SECRET`。

## 4. Sandbox 日曆與測試帳號（EXT-04）

| 帳號 | 用途 | 對 sandbox 日曆的分享權限 |
| --- | --- | --- |
| 擁有者（建立日曆的人） | 建立 sandbox 日曆 | 擁有者 |
| 測試 A（團隊成員，`BOOTSTRAP_TEAM_EMAIL`） | 讀寫驗收 | 「變更活動」（writer） |
| 測試 B（團隊成員） | 唯讀驗收 | 「查看所有活動詳細資料」（reader） |
| 測試 C（團隊成員） | 無權限驗收 | 不分享 |
| 測試 D（測試者，非團隊） | 前台互動資格 | 不分享 |

1. 以擁有者帳號在 Google Calendar 建立「Chainseabase Sandbox」日曆（**不要使用公司正式日曆**），依上表分享。
2. 在 sandbox 日曆建立：一般活動、全天活動、每週重複活動（含一次例外）、含與會者活動，供 C05–C11 使用。
3. 測試 A 登入 staging 後台 → Product 頁 → 連結 Google 日曆 → 綁定「Chainseabase Sandbox」。

## 5. Resend（staging 寄信）

1. Resend → Domains → Add domain：建議用子網域（例：`staging-mail.example.com`），依指示在 DNS 加 SPF／DKIM（必要時 DMARC），等狀態 Verified。
2. API Keys → Create：權限 **Sending access**，限該網域 → `RESEND_API_KEY`。
3. `RESEND_FROM_EMAIL`，例：`Chainseabase Staging <no-reply@staging-mail.example.com>`。
4. staging 只邀請測試帳號 Email；不要寄給真實同事。

## 6. Vercel（staging 變數與網域）

1. Vercel → Add New Project → Import `amber-ou/Chainseabase`；Framework 由 `vercel.json` 帶入；Node.js 版本 22.x；Functions 區域選與 Supabase 相同（`hnd1` 東京或 `sin1` 新加坡）。
2. Settings → Domains：加入 `staging-admin.example.com` 與 `staging-feedback.example.com`，兩者都設定 **Git Branch = `staging`**，依指示設定 DNS。
3. Settings → Environment Variables：以下全部選 **Preview**，並把分支限定為 **`staging`**（不要勾 Production；正式值以後另外設定）。

| 變數 | 值的來源 | 秘密 |
| --- | --- | --- |
| `APP_ENV` | `staging` | 否 |
| `ADMIN_ORIGIN` | `https://staging-admin.example.com` | 否 |
| `PORTAL_ORIGIN` | `https://staging-feedback.example.com` | 否 |
| `DATABASE_URL` | Supabase transaction pooler（`?sslmode=require`） | 是 |
| `DIRECT_DATABASE_URL` | Supabase direct／session pooler（只給 migration；可不放 Vercel） | 是 |
| `AUTH_SESSION_SECRET` | 自己終端機產生（下方指令），≥ 32 字元 | 是 |
| `TOKEN_ENCRYPTION_KEY` | 32 bytes base64（下方指令） | 是 |
| `TOKEN_ENCRYPTION_KEY_VERSION` | `1` | 否 |
| `GOOGLE_CLIENT_ID` | 步驟 3 | 否 |
| `GOOGLE_CLIENT_SECRET` | 步驟 3 | 是 |
| `RESEND_API_KEY` | 步驟 5 | 是 |
| `RESEND_FROM_EMAIL` | 步驟 5 | 否 |
| `SUPABASE_URL` | 步驟 2 | 否 |
| `SUPABASE_SERVICE_ROLE_KEY` | 步驟 2 | 是 |
| `SUPABASE_AVATAR_BUCKET` | `avatars` | 否 |
| `CRON_SECRET` | 自己終端機產生；**不要另設 `JOB_RUNNER_SECRET`**（若兩者都設，應用以 `JOB_RUNNER_SECRET` 為準，Vercel Cron 會被拒） | 是 |
| `CALENDAR_PROVIDER`、`EMAIL_PROVIDER`、`STORAGE_PROVIDER` | 都設 `real`（缺憑證時啟動即失敗，不會默默改用 fake） | 否 |
| `BOOTSTRAP_TEAM_EMAIL` | 測試 A 的 Email | 否 |
| `E2E_TEST_LOGIN` | **不要設定**（staging 一律拒絕） | — |

產生隨機值（自己的終端機）：

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # AUTH_SESSION_SECRET、CRON_SECRET（各產生一次）
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"      # TOKEN_ENCRYPTION_KEY
```

4. Deployment Protection：Preview 預設的 Vercel Authentication 會擋住沒有 Vercel 帳號的測試者與 OAuth 回呼。依公司政策二選一：對 staging 網域關閉保護，或只讓有 Vercel 團隊帳號的人測試。
5. **Vercel Cron 只在 Production 部署執行**，staging 不會自動跑排程。應用會在每個請求完成後立即處理同請求產生的工作；要驗證重試或補跑時，在自己的終端機手動呼叫（見驗證 6）。
6. 推送 `staging` 分支（步驟 1）觸發部署。

## 7. 驗證方法（依序執行，結果記錄到 [驗收追蹤報告](acceptance-report.md)）

| # | 檢查 | 方法 | 預期 |
| --- | --- | --- | --- |
| 1 | 部署與 provider 模式 | `curl https://staging-admin.example.com/api/v1/health` 與 `https://staging-feedback.example.com/api/v1/health` | `{"data":{"ok":true,"environment":"staging","providers":{"calendar":"real","email":"real","storage":"real"}}}`；任一為 `fake` 即不是真實整合 |
| 2 | 環境防呆 | Vercel Logs 無 `Invalid staging configuration`；前台／後台登入頁沒有「測試登入」 | 啟動成功、無測試登入 |
| 3 | Google 登入（EXT-02；A02、A05、A07） | 測試 A 登入後台、測試 D 登入前台；未受邀帳號登入前台 | 首位團隊取得權限；未受邀只能瀏覽；失敗時看 `/login?error=` 代碼與 Logs `auth.callback` |
| 4 | 邀請（EXT-03；A03、A04、A11） | 後台 User → Email 邀請測試 D；收信後以錯誤帳號與正確帳號各接受一次 | Resend Dashboard 顯示 Delivered；邀請紀錄「已寄出」；錯誤帳號 403、正確帳號成功 |
| 5 | 頭像（Storage） | Setting → 上傳頭像 | Supabase `avatars` bucket 出現物件，bucket 仍為 private，頁面可顯示 |
| 6 | 工作程序（O02） | `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://staging-admin.example.com/api/v1/jobs/run`（`CRON_SECRET` 只放在自己終端機的環境變數） | 回傳 `processed` 與 `stats.byState`，`failed` 為 0 |
| 7 | 日曆 ACL 與讀寫（EXT-04；C03、C05–C10、C12–C15） | 測試 A／B／C 依 [交付與驗收](07-delivery-and-acceptance.md) 案例操作 sandbox 日曆 | writer 可讀寫、reader 唯讀、未分享被拒；重複活動「本次／整系列」與 Google 實際結果一致 |
| 8 | 輪詢（C16） | 開兩個瀏覽器，一方在 Google Calendar 新增活動 | 前景 60 秒內出現；切到背景不再請求，回到前景立即更新 |
| 9 | 負載（O05） | 自己的終端機：`LOAD_BASE_URL=https://staging-admin.example.com LOAD_DATABASE_URL=<staging DATABASE_URL> LOAD_ENV_CONFIRM=staging npm run load-test` | 腳本先確認 `/health` 為 staging 才執行；記錄成功率、409 比例與延遲；會在 staging 建立負載測試使用者與 Feedback |
| 10 | 備份還原（O03） | `SOURCE_DATABASE_URL=<staging direct> TARGET_DATABASE_URL=<本機 …_drill> npm run db:restore-drill` | 行數與私人資料摘要一致 |

每一項都要寫明「真實 staging 實測」與日期；若仍以 fake 驗證，維持「通過（mock）」標示，不改寫為真實整合通過。

## 8. 你需要提供或確認的事項（不要在聊天提供秘密值）

- 公司實際網域，以及 staging 兩個子網域名稱。
- Workspace 或一般 Gmail（決定 consent screen Internal／External）。
- 4 個測試 Google 帳號（A–D）與擁有者帳號。
- Resend 可使用的寄件子網域與 DNS 管理權限。
- Vercel 方案（Hobby 不支援分鐘級 Cron，正式環境需要 Pro 或外部排程器）。
- 完成後告知「staging 已設定」，即可依第 7 節執行實測並更新驗收報告。
