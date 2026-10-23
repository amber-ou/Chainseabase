# Chainseabase 專案工作規則

適用於 Claude 在此專案的後續工作。使用者最新明確指示與當前工具／平台規則優先；本文件不授予額外外部服務權限。

## 先了解現況

應用程式已實作（Next.js 16.4.2／TypeScript／PostgreSQL），M1–M7 功能與自動化測試完成；Google OAuth／Calendar、Resend、Supabase Storage 已有真實 adapter 但**尚未以真實帳號實測**，也尚未部署任何雲端環境。開工前先讀 [tasks.md](tasks.md) 的狀態與證據，以及 [驗收追蹤報告](docs/acceptance-report.md)，不要重做已完成的任務。

約 30 人使用的單公司多產品平台，Google 登入、前後台分站、Feedback／Schedule／Roadmap／Personal、站內通知，以及 Google Calendar 讀寫。已選 Next.js／TypeScript、Vercel、Supabase、Resend。

程式位置：`src/modules/`（領域服務，業務規則在這裡）、`src/server/`（HTTP 路由、授權、冪等、outbox、adapters）、`src/features/`（UI）、`db/migrations/`（SQL）、`tests/`。所有 API 走 `src/server/api` 的單一路由器，新增端點時同時加 zod 白名單 schema、權限檢查與整合測試。

## 必讀文件

1. [PRD.md](PRD.md)：目的與範圍。
2. [docs/08-decisions.md](docs/08-decisions.md)：最終決策與工程預設。
3. [specs/README.md](specs/README.md)：依功能找到詳細規格與驗收。
4. [architecture.md](architecture.md)、[data-permissions.md](data-permissions.md)、[ui-ux.md](ui-ux.md)：設計入口。
5. [docs/04-api-contracts.md](docs/04-api-contracts.md)：API 契約。
6. [tasks.md](tasks.md)、[operations.md](operations.md)：進度與營運。

根目錄文件是摘要與入口；`docs/` 保存詳細規格。不要在兩個位置各維護一套不同規則。

## 工作方式

- 先查看工作目錄、Git 狀態與現有使用者變更，保留非本任務修改。雲端任務通常已有隔離 checkout，除非使用者要求，不另建 worktree。
- 依任務 ID 小步完成，開工前確認依賴；完成後更新 tasks 狀態與證據。
- 先讀既有 manifests／lockfiles／版本設定，再使用實際存在的腳本；固定相依版本，不任意切換包管理器或框架。
- 核心邏輯留在服務層；TypeScript 型別不能取代 runtime 驗證、權限與 DB 約束。
- API 明確列出允許欄位；禁止任意 mass assignment。使用參數化查詢，避免記錄 token 或私人正文。
- UI 依 Design System；以使用者內容與真實狀態呈現，不用假成功、假數據或永久 mock 代替完成。
- 只有文件修改時做文件檢查；業務邏輯修改則執行相關測試。失敗需診斷，不刪斷言或把案例改成永遠通過。
- 回報變更、實際執行檢查與剩餘限制；區分 mock／sandbox／正式，以及 passed／failed／skipped／unrun。

## 不可倒退的規則

- Roadmap 單維度、Tag 限 single 群組、同張看板每筆恰一欄；沒有 AND／OR 或人工卡片歸屬。
- 版本欄位與版本 Tag 共用來源；拖曳只改指定維度。
- Personal 保留負責人切換、私人自由欄位、自動儲存，不改共用資料。
- Schedule 表頭算第 1 列，不能操作表頭；移除 clear 歷史不復原內容。
- 內部角色、產品資格與私人 owner 必須後端驗證；管理員不因此能讀別人的私人 Tag／token。
- Google 登入、受邀資格、Calendar scopes 與 Google 日曆 ACL 是不同的檢查。

## 開發與測試指令

以下指令都在儲存庫根目錄執行；細節與環境變數見 [README.md](README.md)。

```bash
git status --short
git diff --check
npm ci
npm run lint
npm run typecheck
npm test                 # 需要 PostgreSQL；TEST_DATABASE_URL 名稱須含 test，會重建 schema
npm run build
npm run security:scan    # build 之後
npm run test:e2e         # 需要空的 chainseabase_e2e（或 E2E_DATABASE_URL）；port 3100
```

| 用途 | 現況（已實際執行成功） |
| --- | --- |
| 安裝相依 | `npm ci`（npm 10、Node ≥ 22.12，lockfile 已提交） |
| 啟動開發 | `npm run dev`（根目錄，port 3000；後台 `http://admin.localhost:3000`、前台 `http://portal.localhost:3000`） |
| lint／typecheck／build | `npm run lint`、`npm run typecheck`、`npm run build`；一次全跑：`npm run check` |
| 單元／整合／E2E 測試 | `npm test`（Vitest，真實 PostgreSQL）、`npm run test:e2e`（Playwright 1440／768／390） |
| DB migration／seed | `npm run db:migrate`（冪等）、`npm run db:bootstrap`（冪等、無示範資料）、`ALLOW_DEV_SEED=1 npm run db:seed-dev`（只限 dev／e2e／test 資料庫） |
| 背景工作 | `npm run jobs:run`；正式由 Vercel Cron 以 `CRON_SECRET` 呼叫 `/api/v1/jobs/run` |
| 部署／復原 | 尚未部署；`vercel.json` 與 CI 已就緒，正式流程見 [operations.md](operations.md)。還原演練：`npm run db:restore-drill`（目標名稱須含 drill） |

測試只用替身（fake）驗證第三方時，回報必須標示為 mock，不可寫成真實整合完成。

## 需求衝突與外部操作

使用者最新已確認決策優先於較舊的對話草案；本版決策紀錄已明確標示被取代規則。對一般工程選擇依文件預設執行，不重問已回答事項。若發現真正改變公開範圍、資料結果或已確認需求的矛盾，指出具體兩條規則與影響，在等待回答時繼續不依賴該決策的工作。

文件本身不代表已授權發布正式站點、寄送真實邀請或修改公司日曆。依當次使用者授權範圍執行；本地與 sandbox 的可逆工作不需要重複確認。秘密透過環境設定提供，勿要求在聊天貼上。
