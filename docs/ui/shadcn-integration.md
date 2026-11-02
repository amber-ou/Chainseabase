# shadcn/ui 整合與後續元件規範

日期：2026-11-02。基準：`claude/keen-lamport-4qb974` 的 `6076fbbee2051e69623186340e48169f545676b3`。

## 已整合的範圍

原專案為 Next.js 16.4.2、React 19.3.1、TypeScript 5.9.3、npm package-lock，使用自訂全域 CSS 與 Taste Achromatic ledger tokens，沒有 Tailwind、components.json 或第三方 UI 元件庫。

新增 Tailwind 4.3.3／PostCSS、shadcn CLI 4.23.0、Radix primitives、Lucide、CVA、cn 與 tw-animate-css，版本固定在 package.json／package-lock.json。套件管理仍使用 npm。

`src/components/ui/` 已提供 Button、Input、Card、Dialog、Dropdown Menu、Tabs、Table、Badge、Select、Tooltip，以及組合表單需要的 Field、Label、Separator。它們是可維護的專案原始碼，而不是只引用外部黑盒元件。

代表頁面是現有 `src/features/dashboard/dashboard.tsx`：產品切換改用 Select，新增／命名改用 Button、Dialog、Input、Field。保持原有路由、API payload、revision、錯誤訊息、日曆與其他功能。關閉對話框會返回觸發按鈕，失敗保留輸入。

之前的 [UI／UX 調整交付文件](../change-requests/sidebar-position.md) 保持獨立且未變更。本次沒有實作其中的 Calendar 拆頁、永久刪除、Logo 或 Login 改版。

## 官方來源與安裝方式

依 [官方 Next.js 整合文件](https://ui.shadcn.com/docs/installation/next)、[手動安裝文件](https://ui.shadcn.com/docs/installation/manual) 與 [Agent Skill 文件](https://ui.shadcn.com/docs/skills)。

此環境的 `ui.shadcn.com` HTTP 請求回應 403，官方 CLI 的 `docs`／`info` registry 請求亦失敗。因此採官方支援的手動安裝：從官方 Git 儲存庫 `shadcn-ui/ui` 的 commit `4aaea19d9cff3e0908e12a8c1d504b8c5ec34610` 取得 `apps/v4/registry/new-york-v4/ui/` 下的元件，調整專案匯入路徑。未停用 TLS 或套件完整性驗證。

有意的局部調整：Dialog 的 Close 翻譯為「關閉」、限制短視窗最大高度並可捲動；Dialog／Select／Dropdown／Tooltip 的堆疊值改用專案共用 tokens，確保高於既有手機導航。其他樣式透過語意 tokens 映射。

`components.json` 使用 new-york、RSC、TypeScript、Lucide 及 `@/components/ui` 別名。官方 CLI 可於可存取 registry 的開發環境繼續使用；這次沒有將離線來源冒充 registry 連線已恢復。需要網路存取 `ui.shadcn.com`、`registry.npmjs.org`、`github.com`。

安裝或重建相依：

```bash
npm ci
npm run dev
```

新增元件先檢查 `src/components/ui/`，再使用專案鎖定的 CLI：

```bash
npx shadcn docs <component>
npx shadcn add <component> --dry-run
npx shadcn add <component>
```

現有檔案先比較 `--diff`，不得直接 `--overwrite` 或重新 init 覆蓋 CSS、tokens 與別名。若 registry 無法存取，先診斷連線；手動新增須使用可追溯官方版本、完整依賴及參照文件。

## Taste、shadcn 與 tokens 的分工

- Taste：整體排版、視覺層級、留白與合適的互動動態，繼續遵守 [既有 Design System](../05-design-system.md) 與固定 taste skill／seed。
- shadcn/ui：基礎元件與可及互動。新 UI 優先使用已安裝元件；其次查官方 registry 並安裝；樣式差異透過 variants／tokens 調整；只有現有元件無法滿足需求才自建。
- Design Tokens：全部在 `src/app/globals.css`。頁面不另訂同名元件的顏色、字型與圓角；`className` 主要做排列與尺寸。
- 新元件統一 Lucide 線條圖示。舊頁的既有 SVG 留到對應頁遷移時處理，不在本次全站換圖示；Logo 與品牌素材不是一般 icon。

| 系統 | 統一來源／規則 |
| --- | --- |
| Color | shadcn background/card/popover → `--surface`，foreground → `--text`，primary → `--primary`，ring → `--focus`，destructive → `--negative`。 |
| Muted | 舊 `--muted` 是文字色；shadcn `bg-muted` 對應 `--raised`，`text-muted-foreground` 才對應 `--muted`，避免相同名稱造成背景衝突。 |
| Typography | 沿用 Geist／Noto Sans TC；字級使用 `--fs-*`，字型使用 `--font`；不下載或更換全站字型。 |
| Spacing | 4px 基準（Tailwind spacing），既有 `--gap`、`--pad`、列高及控制項高度保留。 |
| Radius | sm → `--radius-chip` 4px，md → `--radius-control` 6px，lg/xl → `--radius-card` 8px。 |
| Shadow | 靜止卡片與按鈕無陰影；浮層 md/lg 共用 `--shadow-float`。 |
| States | 語意 focus ring、hover accent、disabled、aria-invalid／Field 錯誤、pending 狀態；減少動態偏好縮短動畫。 |
| Layers | `--z-ui-overlay` 110、popup 120、tooltip 130；高於手機導航 90，低於既有 toast 200。頁面不自行加 z-index。 |

CSS 採 `theme → base → legacy → components → utilities` 分層，原 CSS 保留在 legacy。**不啟用全域 Tailwind Preflight**；只對帶 `data-slot` 的新元件做最小 reset。已安裝的元件也包含 portal 的 data-slot，浮層不依賴父頁繼承 reset。保留舊 CSS，直到對應使用者逐頁遷移完成；勿提前移除。

`@/components/ui` 仍指向舊 `ui.tsx`，供未遷移頁使用；新程式需匯入明確路徑，例如 `@/components/ui/button`。不要新增另一份 Button／Dialog 平行實作。既有客製化 MultiSelect、Schedule、Calendar、Toast 與舊 Modal 暫留，待能完整維持原行為時逐頁替換。

## Agent Skill

依官方命令安裝 shadcn skill，提供給 Codex 與 Claude Code：

```bash
npx skills add shadcn/ui --skill shadcn --agent claude-code codex --copy -y
```

`skills-lock.json` 記錄來源；skill 在 `.agents/skills/shadcn/` 與 `.claude/skills/shadcn/`。使用 copy 模式，避免 Windows checkout 將 symlink 當文字檔。更新時使用同一官方命令同步兩份，不手動分別改規則。沒有移除或替換 Taste；既有 Taste 官方來源與設計方向仍在 Design System 文件中。

## 驗證指令

```bash
npm run lint
npm run typecheck
npm run build
npm run security:scan
npm test
npm run test:ui
npm run test:e2e
```

`test:ui` 是 Vite／Playwright 隔離元件測試，無資料庫需求，不加入正式 Next 路由；檢查 10 個元件的互動、token 實際樣式、無頁面溢出及 axe 可及性，涵蓋 1440／768／390。需已安裝 Playwright Chromium，或設定 `PLAYWRIGHT_CHROMIUM` 指向既有 Chromium。

`npm test` 使用名稱含 test 的隔離 PostgreSQL；E2E 使用名稱含 e2e 的獨立資料庫並重建 schema。不要使用正式 DB。原有測試採 fake 第三方服務；通過不表示真實 Google／Resend 整合已重驗。

新增 `tests/e2e/shadcn.spec.ts` 驗證 Product 建立、命名、Select 切換、slug／路由不變、焦點返回及失敗保留輸入。其 409 錯誤分支用瀏覽器攔截模擬衝突，其餘建立／命名操作使用實際本地 API 與隔離 PostgreSQL。

## 後續遷移建議

先遷移 Setting 的表單／Tabs，再處理 User 清單的 Table／Dropdown Menu／Badge；Feedback 等複雜 Modal 必須連同草稿、鍵盤及關閉確認回歸，不直接全站替換舊 Modal。Sidebar、Login 及產品永久刪除是獨立變更需求，不因導入元件庫順便重設計。

## 本次驗證結果（2026-11-02）

| 檢查 | 實際結果 |
| --- | --- |
| `npm ci` | 最終 lockfile 重裝成功（720 packages），原有 npm peer warnings 保留，未使用 force 或停用驗證。 |
| lint／typecheck | 全部通過，無 lint warnings。 |
| Production build／啟動 | Playwright webServer 執行 `npm run build` 及 `next start` 成功，使用隔離資料庫測試實際頁面與 API。 |
| `npm run security:scan` | 通過，674 個檔案；本次未注入真實第三方 secrets，不表示完成正式秘密稽核。 |
| 單元／整合 | 20 files、197 passed、0 failed。初次直接執行 npm test 為 196 passed／1 failed：容器 PID 1 未回收已退出的服務程序，存在檢查把 zombie 視為存活。事件檔已記錄 wrapper_exited，`/proc` 確認 Z 狀態；用測試專用 Linux subreaper 啟動相同 npm test 後全部通過，沒有更改測試或服務程式。一般 Windows 執行仍用 npm test。 |
| 既有完整 E2E | 初次 65 個案例中 64 passed／1 failed：鍵盤巡覽 User 頁的首個 Tab 偶發停在品牌連結，沒有停在 skip link。未修改版本對照通過，整合版本同一案例連續重跑 3 次均通過。保留此偶發測試紀錄，不將第一輪寫成全綠。 |
| 新增 Product E2E | 1440／768／390 各 2 個案例，共 6 passed。 |
| 10 元件隔離測試 | 1440／768／390，共 3 passed；涵蓋輸入、Dialog／Select／Dropdown／Tabs／Tooltip 互動、Card／Table／Badge 呈現、語意 token 樣式、axe 及無溢出。 |
| 視覺檢查 | 人工檢視 Product 桌面畫面與手機錯誤 Modal 截圖；沒有明顯溢出或遮擋。本輪未執行 Taste inspector，不宣稱取得 Taste 視覺評分。 |
| 邊界 | 原 legacy CSS 本文保持完整；API、領域模組、資料庫 migration 沒有修改。未重新驗證 Windows 實機或真實 Google／Resend。 |

本機驗證使用 Docker PostgreSQL 17、Node 24、系統 Chromium，測試建立獨立的 test／e2e DB，沒有接觸正式資料。

## 修改檔案索引

- 相依／設定：`package.json`、`package-lock.json`、`components.json`、`postcss.config.mjs`、`tsconfig.json`。
- UI：`src/components/ui/*.tsx`（13 個元件檔）、`src/components/ui/LICENSE.md`、`src/lib/utils.ts`、`src/app/globals.css`、`src/features/dashboard/dashboard.tsx`。
- Agent：`.agents/skills/shadcn/`、`.claude/skills/shadcn/`、`skills-lock.json`；兩份 skill 保留相同內容供 Codex／Windows Claude Code 使用。
- 驗證：`playwright.config.ts`、`playwright.ui.config.ts`、`tests/e2e/shadcn.spec.ts`、`tests/ui/`。
- 開發規範／進度：`CLAUDE.md`、`README.md`、`docs/05-design-system.md`、本文件、`tasks.md`。

交接分支：`codex/ui-phase1-handoff`，基於使用者指定分支的完整 HEAD。`docs/change-requests/sidebar-position.md` 以獨立文件提交保存後續階段需求，不將它混作本次已實作功能。提交與遠端同步狀態以 Git 查詢結果為準。

## CC 第一階段交接

先取得 `origin/codex/ui-phase1-handoff`。工作目錄乾淨且目前分支仍以 `6076fbb` 為基準時，可執行 `git merge --ff-only origin/codex/ui-phase1-handoff` 取得完整成果；若無法 fast-forward，先檢查差異，不 reset 或覆寫本地工作。

第一階段先驗證已有整合、修正本階段問題，不重複 init 或覆蓋元件。確認 Tailwind 無全域 Preflight、tokens 保留原語意，跑本文件列出的檢查。後續階段的側邊欄重排、Product 清單、Calendar 拆頁、產品刪除、Logo／Login 改版都只留在交付文件，不在此階段執行。

## CC 第一階段驗證（2026-11-02，Linux 雲端容器）

以 `git merge --ff-only origin/codex/ui-phase1-handoff` 取得 `1960af5`（fast-forward，未 reset 或覆寫）。驗證後只新增一個鍵盤測試；元件、CSS、依賴與 Dashboard 程式未改。

| 檢查 | 結果 |
| --- | --- |
| 新增依賴來源 | 皆為官方維護者與儲存庫：`cn`（shadcn，`shadcn-ui/cn`，shadcn CLI 本身也依賴它）、`radix-ui`、`lucide-react`、`class-variance-authority`、`tw-animate-css`、`tailwindcss`、`@tailwindcss/postcss`、`shadcn`。lockfile 未新增含安裝腳本的套件（仍為 esbuild、fsevents、unrs-resolver）。`cn` 執行期程式碼未使用網路、子程序、環境變數或 eval。注意：`cn` 0.5.1 與 `lucide-react` 1.66.0 在驗證時發布僅 2–3 天，屬很新的版本 |
| 官方 Agent Skill | `.claude/skills/shadcn` 與 `.agents/skills/shadcn` 內容相同；22 個檔案中 21 個與 `shadcn-ui/ui` main 的 `skills/shadcn/` 逐位元相同，`LICENSE.md` 與上游根目錄 `LICENSE.md` 相同 |
| 元件原始碼 | 13 個檔案與官方 `4aaea19` 的 `new-york-v4/ui` 比對：9 個相同；Dialog、Dropdown Menu、Select、Tooltip 只有文件記載的調整（堆疊 tokens、「關閉」、Dialog 最大高度可捲動） |
| CSS 相容性 | production build 的 CSS 無 Preflight（無 `html` 的 `-webkit-text-size-adjust`）；layer 依首次出現為 properties → theme → base → legacy → components → utilities，utilities 高於舊 CSS；舊 CSS 的全域元素規則只有 font／color 繼承、box-sizing 與標題字級，不會干擾新元件；未分層的 CSS 只有字型 `@font-face` |
| Dashboard 遷移 | API、payload、`expectedRevision`、409 文案、建立後導向皆不變；舊 Modal 本來就沒有 Enter 送出或未儲存確認，Escape 關閉與初始焦點行為相同 |
| `npm ci`／lint／typecheck／build／security:scan | 全部 exit 0（scan 740 個檔案） |
| `npm test` | 20 檔 197 passed（本容器直接執行，不需子程序回收工具） |
| `npm run test:ui` | 3 passed（1440／768／390） |
| `npm run test:e2e` | 加入鍵盤測試前 71 passed；加入後 74 passed，0 failed |
| 新增測試 | `shadcn.spec.ts`：只用鍵盤完成新增產品（Enter 開啟、輸入、Tab 到確認、Enter）、產品切換（Enter 開啟、Escape 不切換且焦點回到觸發器、Home／方向鍵、Enter 切換）。前兩版因測試以 `data-highlighted`（下一次 render 才更新）判斷而間歇失敗，改為追蹤焦點後連續 5 次 9／9 通過；元件本身無問題 |
| 截圖 | 檢視 390 寬度的 Dashboard 與錯誤對話框：控制項換行無溢出，錯誤狀態與草稿保留正常 |

未執行：Taste inspector、Windows 主機上的 test:ui／E2E（Windows 需先安裝 Playwright Chromium）、真實 Google／Resend。
