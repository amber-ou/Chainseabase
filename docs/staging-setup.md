# Staging 建置清單

用來把目前的實作部署到**隔離的 staging**，以真實 Google OAuth／Calendar、Resend、Supabase 實測。本文件只列操作步驟與檢查方法；**所有秘密只填在各平台的加密設定或你自己的終端機，不要貼到聊天、Issue、PR 或 Git。**正式環境另需當次發布授權，不在本清單範圍。

## 0. 目前狀態與操作順序

| 項目 | 已在儲存庫 | 尚缺（需要你在外部平台完成） |
| --- | --- | --- |
| 部署分支 | `staging` 已建立於 `795def347ae1eb3d7ecaaaa70ebfd3b4d742f4b9`（PR #1 已通過 CI 的 head） | — |
| Vercel | `vercel.json`（Next.js、`npm ci`、`npm run build`、Cron `/api/v1/jobs/run` 每 5 分鐘） | Vercel 專案、只建置 `staging` 的設定、staging 網域、環境變數 |
| Supabase | `db/migrations/*.sql`（`npm run db:migrate` 冪等）、`npm run db:bootstrap`（無示範資料）；連線已設 `prepare: false` 可用 transaction pooler | staging 專案、連線字串、private bucket |
| Google | OAuth 流程與 callback 路由已實作；scopes 見下 | OAuth client、consent screen、sandbox 日曆與測試帳號 |
| Resend | 寄送 adapter、失敗重試、邀請紀錄狀態 | 已驗證寄件網域、API key |
| 環境防呆 | `APP_ENV=staging` 與正式相同：拒絕 fake provider 與測試登入；必須明確提供 `DATABASE_URL`、`ADMIN_ORIGIN`、`PORTAL_ORIGIN`（不退回本機預設），兩個 origin 須為不同的 HTTPS 網站且不含路徑；缺少或不合規時啟動即失敗，錯誤只列變數名稱 | — |
| CI | `.github/workflows/ci.yml`（PR 與 `claude/**` 推送；`staging` 推送不跑 CI，只推送已通過 CI 的 commit） | — |

建議順序（前一步的輸出是後一步的輸入）：

1. 決定 staging 兩個網址（第 1 節）——Google callback 與 Vercel 變數都要用到。
2. Supabase 專案與資料庫初始化（第 2 節）——**首次登入前**必須完成 migrate 與 bootstrap。
3. Google OAuth client（第 3 節）、sandbox 日曆與測試帳號（第 4 節）、Resend 網域（第 5 節，DNS 生效可能需要時間，可提早開始）。
4. Vercel 專案、網域與變數（第 6 節），部署 `staging`。
5. 依第 7 節驗證。

## 1. 部署分支與網域

| 環境 | Git 分支 | Vercel 環境 | 網域（範例，換成公司網域） |
| --- | --- | --- | --- |
| Staging | **`staging`** | Preview（只對 `staging` 分支設定變數與網域） | 後台 `staging-admin.example.com`、前台 `staging-feedback.example.com` |
| Production | `main` | Production | 尚未建立；需當次發布授權 |

網址規則（應用在 `APP_ENV=staging` 時會檢查，不符合就拒絕啟動）：

- 兩個**不同的主機名稱**（同主機不同 port 也不行），都必須是 `https://`。
- 只寫 origin：`https://staging-admin.example.com`（結尾斜線可有可無，不能有路徑、查詢字串或帳密）。
- 不要使用正式環境預定的名稱。session cookie 綁定各自主機，兩個子網域互不共用登入。
- 若暫時沒有公司網域，可用兩個 `*.vercel.app` 名稱，但 Google OAuth 對這類共用網域可能有限制；建議使用公司子網域。
- 只有這兩個主機能開啟頁面；Vercel 自動產生的部署網址（隨機 `*.vercel.app`）開頁面會回 `421 Unknown host`，屬預期行為，驗證一律用這兩個網址。

更新 staging 分支（只推送已通過 CI 的 commit，**不要強制覆寫**；在自己的 clone 執行）：

```bash
git fetch origin
git push origin <已通過 CI 的 commit SHA>:refs/heads/staging   # 非快轉會被拒絕，代表 staging 上有其他工作，先確認再處理
```

## 2. Supabase（staging 專用專案）

1. Supabase Dashboard → New project：名稱 `chainseabase-staging`；區域建議 `ap-northeast-1`（東京）或 `ap-southeast-1`（新加坡）。**建議**與第 6 節的 Vercel Functions 區域相同以降低延遲，不是必要條件。資料庫密碼存在密碼管理工具。
2. Project Settings → Database → Connection string（或頁面上方 Connect）：
   - **Transaction pooler**（port 6543）→ `DATABASE_URL`。
   - **Direct connection**（port 5432；若你的網路只支援 IPv4，改用 **Session pooler**）→ `DIRECT_DATABASE_URL`，只給 migration／bootstrap 使用。
   - **保留連線字串原本的所有參數**，應用與腳本會原樣使用。只有在字串完全沒有 `sslmode` 時才補上：沒有 `?` 就加 `?sslmode=require`，已有 `?` 就加 `&sslmode=require`；不要刪除或改寫既有參數。
   - 把 `[YOUR-PASSWORD]` 換成實際密碼時，密碼若含 `@ : / ? # %` 等字元需先 URL 編碼。
3. Storage → New bucket：名稱 `avatars`，**Public 關閉**（private）。Project Settings → API：Project URL → `SUPABASE_URL`；`service_role` key → `SUPABASE_SERVICE_ROLE_KEY`（只放伺服器端，不可加 `NEXT_PUBLIC_`）。
4. Database → Backups：確認方案的每日備份與保留天數，記錄在 [operations.md](../operations.md)。
5. 在你自己的終端機初始化（連線字串只放在這個終端機的環境變數，不要貼到聊天）。設定 `APP_ENV=staging` 後，腳本**沒有明確連線字串就拒絕執行**，不會誤連本機資料庫；執行前會印出目標主機（不含帳密），請先確認是 staging：

   ```bash
   export APP_ENV=staging
   export DIRECT_DATABASE_URL='<staging direct 或 session pooler 連線字串>'
   npm ci
   npm run db:migrate          # 先印出「Migrating <host>:<port>/<db>」；冪等，可重跑
   DATABASE_URL="$DIRECT_DATABASE_URL" BOOTSTRAP_TEAM_EMAIL='<測試 A 的 Email>' npm run db:bootstrap
   ```

   驗證：`db:migrate` 第二次執行應顯示 `Database schema is up to date.`；`db:bootstrap` 顯示產品已建立與首位團隊授權狀態。**必須在任何人首次登入前完成**，否則登入會因資料表不存在而失敗。

## 3. Google Cloud（staging 專用 OAuth client）

1. Google Cloud Console 建立或選擇專案（建議 `chainseabase-staging`，與正式分開）。APIs & Services → Library → 啟用 **Google Calendar API**。
2. OAuth consent screen（較新的介面在 **Google Auth Platform** 下分為 Branding／Audience／Data Access）：
   - 公司為 Google Workspace 且只給內部帳號 → User type **Internal**。
   - 否則 **External**，Publishing status 保持 **Testing**，在 Test users 加入所有 staging 測試帳號（Testing 狀態下 refresh token 7 天過期，實測 C15 時要注意）。
   - Authorized domains：加入 staging 網址的上層網域（例 `example.com`）。
   - Scopes：`openid`、`email`、`profile`、`https://www.googleapis.com/auth/calendar.events`、`https://www.googleapis.com/auth/calendar.calendarlist.readonly`。
3. Credentials（或 Clients）→ Create OAuth client ID → **Web application**，Authorized redirect URIs **完全照抄**（含 `https`、無結尾斜線；網域換成第 1 節決定的網址）：

   ```text
   https://staging-admin.example.com/api/v1/auth/google/callback
   https://staging-feedback.example.com/api/v1/auth/google/callback
   https://staging-admin.example.com/api/v1/integrations/google/calendar/callback
   ```

   Authorized JavaScript origins 可留空（伺服器端授權碼流程）。Client ID → `GOOGLE_CLIENT_ID`；Client secret → `GOOGLE_CLIENT_SECRET`（只放 Vercel）。
4. 驗證（部署後）：兩個網址各按一次 Google 登入。Google 顯示 `redirect_uri_mismatch` 代表 URI 與實際網址有任何一個字元不同；應用端錯誤會回 `/login?error=`（`denied`、`state`、`unverified`、`failed`），對照 Vercel Logs 的 `auth.callback`。

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
3. 測試 B、C 成為團隊成員的方式：測試 A 登入後台 → User → Email 邀請（角色選團隊成員）；這同時是第 7 節邀請驗證的一部分。
4. 測試 A 登入 staging 後台 → Product 頁 → 連結 Google 日曆 → 綁定「Chainseabase Sandbox」。

## 5. Resend（staging 寄信）

1. Resend → Domains → Add domain：建議用子網域（例：`staging-mail.example.com`），依指示在 DNS 加 SPF／DKIM（必要時 DMARC），等狀態 Verified（DNS 生效可能需要數小時，可提早做）。
2. API Keys → Create：權限 **Sending access**，限該網域 → `RESEND_API_KEY`。
3. `RESEND_FROM_EMAIL`，例：`Chainseabase Staging <no-reply@staging-mail.example.com>`；寄件網域必須是已 Verified 的網域。
4. staging 只邀請測試帳號 Email；不要寄給真實同事。

## 6. Vercel（隔離的 staging，不自動發布 production）

1. Vercel → Add New Project → Import `amber-ou/Chainseabase`；Framework 由 `vercel.json` 帶入；Settings → General → Node.js Version 選 22.x；Settings → Functions → Function Region **建議**與 Supabase 相同（東京 `hnd1`、新加坡 `sin1`），不同區域仍可運作但延遲較高。
2. **只建置 `staging`，不自動發布 production**：Settings → Git → **Ignored Build Step** → 選自訂指令：

   ```bash
   if [ "$VERCEL_GIT_COMMIT_REF" = "staging" ]; then exit 1; else exit 0; fi
   ```

   Vercel 規則：指令結束碼 1 才建置、0 則略過。如此 `main`（Production）與 `claude/**` 等其他分支都會被略過，合併 PR 不會自動發布正式環境。取得正式發布授權時再調整這個設定。
3. **不要設定任何 Production 環境變數**：即使 production 部署意外發生，應用也會因缺少必要變數而拒絕啟動（第二層保護）。
4. Settings → Domains：加入第 1 節的兩個網址，兩者都設定 **Git Branch = `staging`**，依 Vercel 顯示的記錄（通常是 CNAME）設定 DNS，等兩個網域都顯示 Valid Configuration。
5. Settings → Environment Variables：以下全部只勾 **Preview**，並把分支限定為 **`staging`**（不要勾 Production 或 Development）。**變更變數後需重新部署才會生效**（Deployments → 最新的 staging 部署 → Redeploy）。

| 變數 | 值的來源 | 秘密 |
| --- | --- | --- |
| `APP_ENV` | `staging` | 否 |
| `ADMIN_ORIGIN` | 第 1 節後台網址，例 `https://staging-admin.example.com`（必填、HTTPS、與前台不同主機） | 否 |
| `PORTAL_ORIGIN` | 第 1 節前台網址，例 `https://staging-feedback.example.com`（必填、HTTPS、與後台不同主機） | 否 |
| `DATABASE_URL` | Supabase transaction pooler，**原樣貼上並保留原有參數**（必填） | 是 |
| `DIRECT_DATABASE_URL` | Supabase direct／session pooler（只給 migration；可不放 Vercel） | 是 |
| `AUTH_SESSION_SECRET` | 自己終端機產生（下方指令），≥ 32 字元 | 是 |
| `TOKEN_ENCRYPTION_KEY` | 32 bytes base64（下方指令） | 是 |
| `TOKEN_ENCRYPTION_KEY_VERSION` | `1` | 否 |
| `GOOGLE_CLIENT_ID` | 第 3 節 | 否 |
| `GOOGLE_CLIENT_SECRET` | 第 3 節 | 是 |
| `RESEND_API_KEY` | 第 5 節 | 是 |
| `RESEND_FROM_EMAIL` | 第 5 節 | 否 |
| `SUPABASE_URL` | 第 2 節 | 否 |
| `SUPABASE_SERVICE_ROLE_KEY` | 第 2 節 | 是 |
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

6. Deployment Protection：Preview 預設的 Vercel Authentication 會擋住沒有 Vercel 帳號的測試者與 OAuth 回呼。依公司政策二選一：對 staging 網域關閉保護，或只讓有 Vercel 團隊帳號的人測試。
7. **Vercel Cron 只在 Production 部署執行**，staging 不會自動跑排程。應用會在每個請求完成後立即處理同請求產生的工作；要驗證重試或補跑時，在自己的終端機手動呼叫（見驗證 6）。
8. 部署：`staging` 分支已存在；設定完成後到 Deployments 對 `staging` 執行 Redeploy（或推送新的已通過 CI 的 commit 到 `staging`）。Deployments 清單中 `main` 與其他分支應顯示為略過（Ignored／Canceled）。

## 7. 驗證方法（依序執行，結果記錄到 [驗收追蹤報告](acceptance-report.md)）

| # | 檢查 | 方法 | 預期 |
| --- | --- | --- | --- |
| 1 | 部署設定 | `curl https://staging-admin.example.com/api/v1/health` 與 `https://staging-feedback.example.com/api/v1/health` | `{"data":{"ok":true,"environment":"staging","providers":{"calendar":"real","email":"real","storage":"real"}}}`。任一為 `fake` 代表設定錯誤。**`real` 只表示已設定憑證並選用真實 adapter，不代表 Google、Resend、Supabase 已實際呼叫成功**；外部服務是否可用以第 3–8 項的實際操作結果為準 |
| 2 | 環境防呆 | Vercel → Deployments → 該部署 → Logs（Runtime） | 沒有 `Invalid staging configuration: …`（若有，訊息列出缺少或不合規的變數名稱，例如 `DATABASE_URL`、`ADMIN_ORIGIN must use https`、`ADMIN_ORIGIN and PORTAL_ORIGIN must be different sites`）；兩個網址的登入頁都沒有「測試登入」 |
| 3 | Google 登入（EXT-02；A02、A05、A07） | 測試 A 登入後台、測試 D 登入前台；未受邀帳號登入前台 | 首位團隊取得權限；未受邀只能瀏覽；失敗時看 `/login?error=` 代碼與 Logs `auth.callback` |
| 4 | 邀請（EXT-03；A03、A04、A11） | 後台 User → Email 邀請測試 D；收信後以錯誤帳號與正確帳號各接受一次 | Resend Dashboard → Emails 顯示 Delivered；邀請紀錄「已寄出」；錯誤帳號被拒（403）、正確帳號成功 |
| 5 | 頭像（Storage） | Setting → 頭像 → 選擇圖片（JPEG／PNG／WebP，≤ 2 MB） | Supabase Storage → `avatars` 出現物件，bucket 仍為 private，頁面可顯示 |
| 6 | 工作程序（O02） | `curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://staging-admin.example.com/api/v1/jobs/run`（`CRON_SECRET` 只放在自己終端機的環境變數） | 回傳 `processed` 與 `stats.byState`，`failed` 為 0 |
| 7 | 日曆 ACL 與讀寫（EXT-04；C03、C05–C10、C12–C15） | 測試 A／B／C 依 [交付與驗收](07-delivery-and-acceptance.md) 案例操作 sandbox 日曆 | writer 可讀寫、reader 唯讀、未分享被拒；重複活動「本次／整系列」與 Google 實際結果一致；Logs `calendar.callback` 無錯誤 |
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
