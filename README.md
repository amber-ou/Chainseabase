# Chainseabase

現行部署入口：[Windows 原生規格與 WIN 任務](docs/windows-native-deployment.md)。核心功能沿用既有實作；部署與受邀讀取改造尚待驗收。

公司內部使用的多產品需求與回饋管理平台，目標約 30 位使用者。一個 Next.js 應用提供兩個網站入口：團隊後台（Product／Feedback／Roadmap／Personal／User／Notification／Setting 與 Google 日曆）與獨立的受邀成員前台（存取改造待 WIN-04），共用服務層與 PostgreSQL。

**目前狀態**：M1–M7 的應用程式已實作並以單元、真實 PostgreSQL 整合與 Playwright E2E 驗證；使用者已回報 Windows 本機 migration／bootstrap、建置、啟動及真實 Google 登入成功；日曆、寄信、正式本機儲存與 Windows 服務尚待驗證。進度與證據見 [tasks.md](tasks.md) 與 [驗收追蹤報告](docs/acceptance-report.md)。

## 技術組成

| 項目 | 選擇（鎖定版本見 `package.json`／`package-lock.json`） |
| --- | --- |
| 執行環境 | Node.js ≥ 22.12（開發驗證於 22.22.0）、npm 10 |
| 框架 | Next.js 16.4.2（App Router、Turbopack）、React 19.3、TypeScript 5.9 |
| 資料庫 | PostgreSQL（舊 CI：16；使用者本機：18.6，完整相容性待驗證），`postgres` 3.4 driver、版本化 SQL migration |
| 驗證 | Zod 4（runtime 輸入驗證）、jose（Google ID token 驗證、OAuth 暫存 cookie 簽章） |
| 測試 | Vitest 5（單元＋整合）、fast-check（property-based）、Playwright 1.63（E2E） |
| 第三方 | Google OAuth／Calendar REST、Resend REST、Supabase Storage REST（皆有 fake 替身） |

## 快速開始（本機開發）

以下為既有 Bash 開發範例，不可直接複製環境變數語法到 PowerShell。Windows 原生流程以 [維運文件](operations.md) 與 [新部署規格](docs/windows-native-deployment.md) 為準；依 WIN-01 補交可重現的安全載入工具。

```bash
# 1. 安裝固定版本相依
npm ci

# 2. 準備 PostgreSQL 16 與資料庫（範例使用本機帳號 chainsea/chainsea）
createdb chainseabase_dev

# 3. 建立本機環境檔（不提交 Git）
cp .env.example .env.local
#   至少設定 DATABASE_URL、ADMIN_ORIGIN、PORTAL_ORIGIN、AUTH_SESSION_SECRET、TOKEN_ENCRYPTION_KEY
#   沒有 Google 帳號時可加上 E2E_TEST_LOGIN=enabled 使用「測試登入」（僅開發／E2E，正式環境自動停用）

# 4. 建立資料表（可重複執行）與正式初始化（產品1、預設分類、首位團隊 Email）
npm run db:migrate
BOOTSTRAP_TEAM_EMAIL=you@company.com npm run db:bootstrap

# 5.（選用）只在本機資料庫植入示範資料
ALLOW_DEV_SEED=1 npm run db:seed-dev

# 6. 啟動
npm run dev
```

目前已驗證的 Windows 本機入口是 <http://localhost:3000>（後台）與 <http://127.0.0.1:3000>（前台）。兩個 host 必須與 `ADMIN_ORIGIN`／`PORTAL_ORIGIN` 及 Google callback 一致，session cookie 各自 host-only。僅綁 loopback，不將 development 配置對外開放。

示範資料的測試帳號：`lead@dev.local`（團隊）、`dev@dev.local`、`qa@dev.local`、`tester@dev.local`（測試成員）；在登入頁的「測試登入」輸入 Email 即可。

## 指令

| 用途 | 指令（儲存庫根目錄） | 備註 |
| --- | --- | --- |
| 安裝 | `npm ci` | 依 lockfile 安裝 |
| 開發伺服器 | `npm run dev` | port 3000 |
| Lint | `npm run lint` | ESLint 10.13（eslint-config-next 16.4.2） |
| 型別檢查 | `npm run typecheck` | `tsc --noEmit` |
| 單元＋整合測試 | `npm test` | 需要 PostgreSQL；預設 `postgres://chainsea:chainsea@127.0.0.1:5432/chainseabase_test`，可用 `TEST_DATABASE_URL` 覆寫（名稱必須含 `test`，每次執行會重建 schema） |
| 只跑單元／整合 | `npm run test:unit`／`npm run test:integration` | |
| E2E | `npm run test:e2e` | 需要空的 `chainseabase_e2e` 資料庫（或 `E2E_DATABASE_URL`，名稱必須含 `e2e`）；會先 build 再於 port 3100 啟動，執行 1440／768／390 三種寬度 |
| Production build | `npm run build`，啟動 `npm start` | |
| 秘密掃描 | `npm run security:scan` | build 之後執行；掃描 client bundle 與 Git 追蹤檔 |
| 全部檢查 | `npm run check` | lint → typecheck → test → build → security:scan |
| Migration | `npm run db:migrate` | 使用 `DIRECT_DATABASE_URL`（若有）否則 `DATABASE_URL` |
| 正式初始化 | `npm run db:bootstrap` | 冪等；團隊已存在時不再建立首位團隊授權 |
| 示範資料 | `ALLOW_DEV_SEED=1 npm run db:seed-dev` | 只允許名稱含 dev／e2e／test 的資料庫 |
| 背景工作 | `npm run jobs:run` | 處理通知與邀請信 outbox；正式環境由排程呼叫 `/api/v1/jobs/run` |
| 還原演練 | `SOURCE_DATABASE_URL=… TARGET_DATABASE_URL=…drill… npm run db:restore-drill` | 目標資料庫名稱必須含 `drill` |
| 負載測試 | `LOAD_BASE_URL=… LOAD_DATABASE_URL=… npm run load-test` | `LOAD_SCENARIO=normal｜contention｜both`（預設 both）、`LOAD_USERS`、`LOAD_SECONDS`、`LOAD_THINK_MS=2000-6000`；只允許名稱含 e2e／load／staging 的資料庫，或 `LOAD_ENV_CONFIRM=staging` 且伺服器 `/health` 回報 staging；結束時檢查看板不變量，違反時 exit 2 |

## 專案結構

```text
src/app/            # 前後台頁面與 /api/v1 單一路由入口（route handler → src/server/api）
src/features/       # 各頁面 UI（feedback、schedule、roadmap、personal、calendar、portal…）
src/components/     # 共用元件（Modal、Tabs、MultiSelect、Menu、Markdown、狀態元件）
src/modules/        # 領域服務：identity、products、feedback、schedule、roadmap、personal、notifications、calendar
src/server/         # 設定、DB、HTTP 路由、session、授權、冪等、outbox、第三方 adapters
db/migrations/      # 版本化 SQL（含限制、trigger）
scripts/            # migrate、bootstrap、seed、jobs、restore drill、load test、secret scan
tests/              # unit、integration（真實 PostgreSQL）、e2e（Playwright）
```

## 文件

從 [START-DEVELOPMENT.md](START-DEVELOPMENT.md) 與 [文件索引](docs/README.md) 開始。產品與規格：[PRD.md](PRD.md)、[specs/](specs/README.md)、[data-permissions.md](data-permissions.md)、[ui-ux.md](ui-ux.md)、[architecture.md](architecture.md)；工作規則：[CLAUDE.md](CLAUDE.md)；任務與證據：[tasks.md](tasks.md)；部署與維運：[operations.md](operations.md)；驗收結果：[docs/acceptance-report.md](docs/acceptance-report.md)。

介面為繁體中文，顯示時區 `Asia/Taipei`，資料庫時間戳為 UTC。
