# 驗收追蹤報告（實作第二輪：上線前收尾）

對照 [交付與驗收](07-delivery-and-acceptance.md) 的 99 項案例，記錄目前實際的驗證方式與結果。**本報告只記錄已執行的結果；未執行或只用模擬服務驗證的項目明確標示，不視為完整通過。**

## 執行紀錄

| 項目 | 內容 |
| --- | --- |
| 日期 | 2026-10-23（Asia/Taipei） |
| 環境 | 雲端開發容器：Node 22.22.0、PostgreSQL 16.15（本機）、Chromium（Playwright 1.63） |
| 程式版本 | 分支 `claude/keen-lamport-4qb974`（見 Git 紀錄） |
| 資料集 | 測試自建：產品甲／乙、團隊甲／乙、受邀產品甲的測試者、未受邀帳號、UIUX／前端／後端、版本 single、用途 multiple、未分組 Tag（`tests/helpers/harness.ts`）；E2E 使用隔離資料庫 `chainseabase_e2e` |
| 第三方 | Google OAuth／Calendar、Resend、Supabase Storage **皆為 fake／本機替身**；未連線任何真實帳號 |

| 指令（儲存庫根目錄） | 結果 |
| --- | --- |
| `npm run lint` | 通過，0 error／0 warning |
| `npm run typecheck` | 通過 |
| `npm test`（Vitest：單元＋真實 PostgreSQL 整合） | 13 個檔案、139 tests：139 passed、0 failed、0 skipped |
| `npm run build` | 通過（Next.js 16.4.2 production build） |
| `npm run security:scan` | 通過（client bundle＋Git 追蹤檔案，635 個檔案） |
| `npm run test:e2e`（Playwright：1440／768／390） | 55 tests：55 passed、0 failed、0 skipped（含 axe 可及性 16、C16 輪詢 1） |
| taste skill `lint.mjs --app`（固定 commit 6010f91） | `src/` 0 FAIL、0 WARN（保留理由見 V04） |
| taste skill `inspect.mjs --app`（1440／768／390） | 前台 Feedback、前台 Roadmap、登入頁、後台 Product／Feedback／Roadmap／Personal／User／Setting：全部 0 FAIL；WARN 理由見 V04 |
| `npm run db:restore-drill`（本機 dev → drill） | 41 張表、行數一致、私人資料摘要一致 |
| `npm run load-test`（本機 production build，30 人 × 60 秒，normal＋contention） | 見 O05 |

狀態說明：**通過**＝自動化測試已執行並通過；**通過（mock）**＝以第三方替身驗證本平台邏輯，仍需 sandbox 實測；**部分**＝主要行為已驗證、仍有人工或外部步驟；**未執行**＝尚未驗證。

## AUTH／PROD／權限

| ID | 狀態 | 證據 |
| --- | --- | --- |
| A01 | 通過 | `identity.test.ts` 重跑與併發 bootstrap，只有一份產品1／預設值／首位團隊資格 |
| A02 | 通過 | 整合＋E2E（`portal.spec.ts`）：未受邀帳號只能瀏覽，顯示缺少互動資格 |
| A03 | 通過 | Email 不符時 403 且邀請未被消耗 |
| A04 | 通過 | 首次接受授權、重送回 alreadyAccepted、撤銷／過期 410 |
| A05 | 通過 | 測試者呼叫後台 API 403、跨產品互動 403、前台 host 不提供內部端點；E2E 後台顯示無權限 |
| A06 | 通過 | 兩人同時降級／移除，advisory lock 保證保留一位團隊成員 |
| A07 | 通過 | 移除後舊 session 下一次請求 401，作者保留 |
| A08 | 通過 | 伺服器拒絕跨產品 ID；E2E 延遲舊產品回應 2.5 秒後切換產品，新產品畫面不被覆蓋；切換時有未儲存草稿會先提示 |
| A09 | 通過 | 新增／改名保留 ID 與 slug，無刪除端點 |
| A10 | 通過 | 他人 Personal／私人 Tag 回 404，回應不含 token |
| A11 | 通過 | 寄信失敗重試、同一連結、無重複邀請、log 不含 token（fake 寄信） |
| A12 | 通過 | 降為 tester 未指定產品＝無產品；Person tag 撤除、後台 session 失效 |

真實 Google 登入（EXT-02）與真實寄信（EXT-03）：**未執行**。

## Feedback／Setting／前台

| ID | 狀態 | 證據 |
| --- | --- | --- |
| F01 | 通過 | 整合（預設值、禁止代填 author/createdAt）＋E2E（Modal 預設欄位） |
| F02 | 通過 | E2E 連續新增保留分類、清空標題與 Schedule；整合驗證冪等與失敗保留 |
| F03 | 通過 | 版本 Dropdown、Tag、Roadmap 三入口同一資料 |
| F04 | 通過 | single 拒絕、multiple 接受、併發只成功一筆、DB trigger 擋直接寫入 |
| F05 | 通過 | 未安排清除實際職掌、無通知、保留名稱不可建立 |
| F06 | 通過 | 顯示影響、需替代、遷移與欄位同交易 |
| F07 | 通過 | multiple→single 需先清理、被看板使用不可改 multiple、版本群組固定 |
| F08 | 通過 | 受邀者成功且公開；匿名／未受邀／他產品拒絕（整合＋E2E） |
| F09 | 通過 | 公開 DTO 欄位白名單，回應不含 Person tag／版本／Email／Schedule |
| F10 | 通過 | 改回內部後直接網址、搜尋、通知、作者編輯皆不可得；回應 no-store |
| F11 | 通過 | 公開 Feedback 的一般留言公開、Schedule 不公開；後台留言框標示公開 |
| F12 | 通過 | 投票／按讚 PUT 冪等、DELETE 歸零（整合＋E2E） |
| F13 | 通過 | 測試者不可改他人內容或 mass assign |
| F14 | 通過 | 繁中片段、`%`／`_`／引號參數化搜尋，範圍正確 |
| F15 | 通過 | 原文保存；前台 Markdown 不渲染 HTML、連結協定白名單（單元＋E2E） |

## Schedule

| ID | 狀態 | 證據 |
| --- | --- | --- |
| S01 | 通過 | 五欄、一列、表頭不可為目標；E2E 點格帶入 `/2-3` |
| S02–S08 | 通過 | `schedule.test.ts`、`tests/unit/schedule.test.ts`；S02–S05 另有 E2E |
| S09 | 通過 | 注入 DB 失敗後全部 rollback，同 key 重試只成功一次 |
| S10 | 通過 | 同 revision 併發寫入／清空，一筆成功一筆 409 |
| S11 | 通過 | E2E：草稿取消後不建立任何資料；草稿只存於前端 |
| S12 | 通過 | 草稿於建立交易重播，作者／時間由伺服器、引用正確；失敗全不提交 |
| S13–S16 | 通過 | 整合測試 |
| S17 | 通過 | API 區分寫入／清空筆數；E2E 驗證「已套用至草稿」「已寫入 1 筆」「已清空 2 筆」與 aria-live |

## Roadmap

| ID | 狀態 | 證據 |
| --- | --- | --- |
| R01–R05 | 通過 | `roadmap.test.ts`；R05 列舉 15 筆 × 4 張看板恰一欄 |
| R06 | 通過 | 整合＋E2E（鍵盤可操作的選單移動） |
| R07–R12 | 通過 | 整合；另有 property-based 不變量（`tests/unit/roadmap.test.ts`） |
| R13 | 通過 | 同卡併發：第二個寫入回 409 `card_changed`，不重複、不覆蓋；不同卡同時移動全部成功、無重複 rank 或並列 rank；相鄰卡失效回 409 `order_changed`；重編號與移出交錯的回歸測試（`Roadmap move concurrency scope`，9 個案例）。負載下不變量見 O05 |
| R14 | 通過 | 只列發布的狀態看板、只含公開卡片與公開數量、前台無寫入端點 |

## Personal／Notification

| ID | 狀態 | 證據 |
| --- | --- | --- |
| P01–P08 | 通過 | `personal-notifications.test.ts`；P03／P05 另有 E2E（自動儲存狀態） |
| N01–N06 | 通過 | 同上；worker 重跑不重複、測試者不收 Schedule 通知 |

## Calendar（目前僅 fake provider）

| ID | 狀態 | 證據 |
| --- | --- | --- |
| C01 | 通過 | 未授權時其他功能正常、日曆提示連結 |
| C02 | 通過（mock） | 錯誤帳號、缺 scope 拒絕且不覆蓋有效憑證 |
| C03 | 通過（mock） | writer／reader／未分享分別讀寫／唯讀／拒絕；**sandbox 未執行** |
| C04 | 通過 | 只用產品綁定日曆，偽造 calendarId／過期 bindingRevision 拒絕 |
| C05–C10 | 通過（mock） | fake 日曆 CRUD、全天 exclusive end、DST、本次／整系列、master ETag；**C10 Google 實際例外行為未在 sandbox 記錄** |
| C11 | 通過（mock） | 複雜規則、特殊類型、含與會者活動受保護 |
| C12–C15 | 通過（mock） | 回應遺失重試只一筆、ETag 衝突、401/429/逾時、無新 refresh token 保留舊值 |
| C16 | 通過（mock） | API 完整分頁（mock）；E2E（Playwright 假時鐘）驗證前景 60 秒刷新、背景 3 分鐘無請求、回前景與重新聚焦立即刷新。真實 Google 日曆的他人變更出現時間待 sandbox |
| C17 | 通過 | 解除個人連線／產品綁定不刪活動，他人授權不受影響 |
| C18 | 通過 | 他產品 Feedback 拒絕，關聯不改 Feedback／Schedule |

依驗收文件，C03／C05–C10／C12–C15 **仍需在 sandbox 日曆實測**後才能把 M6 標為完成（需 EXT-02、EXT-04）。

## 視覺、可及性與營運

| ID | 狀態 | 證據 |
| --- | --- | --- |
| V01 | 通過 | E2E 在 1440／768／390 檢查 6 個後台頁、前台頁與 Schedule：無整頁橫向溢出、手機折疊選單；截圖附於 Playwright 報告 |
| V02 | 部分 | E2E：Modal Escape／焦點循環、看板選單鍵盤移動；Dropdown／Tabs 使用原生控制與方向鍵；axe-core WCAG 2.1 A／AA（`a11y.spec.ts`）後台 6 頁、Modal＋Schedule、前台與登入頁在 1440／390 皆 0 violation（修正看板／Schedule 捲動容器不可聚焦）。螢幕閱讀器實機測試與人工鍵盤走查**未執行** |
| V03 | 部分 | 成功／錯誤／儲存中均有文字＋圖示與 aria-live（E2E 驗證 Schedule 與看板宣告）；其餘狀態為程式審查 |
| V04 | 部分 | taste lint 0 FAIL／0 WARN（mono 只用於指令座標與 slug、陰影只用於 Modal／選單浮層、時鐘補零已標註）；inspector 以本機反向代理注入測試 session 後檢查後台 6 頁與前台 3 頁：全部 0 FAIL。修正：手機短頁頂部空白、看板工具列溢出、Feedback 列中繼資料溢出、數字欄靠右、手機看板改為一欄一屏仍在容器內橫向捲動。保留 WARN：內容少造成的空白（開發資料量小）、看板各欄卡片數不同的不等高（看板本質）。人工視覺審查未正式簽核 |
| O01 | 部分 | 單元：production 與 `APP_ENV=staging` 皆拒絕 fake provider、測試登入、缺 secret（只列名稱）；`/api/v1/health` 回報環境與 provider 模式；staging／production 實際分離待 EXT-01（步驟見 [Staging 建置清單](staging-setup.md)） |
| O02 | 通過 | 租約過期後續跑、通知不重複、超過次數停止重試 |
| O03 | 部分 | 本機 pg_dump／pg_restore 演練一致；**Supabase 正式備份還原未執行** |
| O04 | 通過 | `security:scan` 掃描 client bundle 與 Git；log 遮罩測試；API 錯誤不含 SQL |
| O05 | 部分 | 本機 30 人：正常頻率所有 API p95 ≤ 49 ms，移動首次成功 99.1%、重試後 100%；高競爭同欄拖曳不同卡片重試後 88.0%（舊版 6.8%），剩餘 409 為相鄰卡真的被移動；不變量全數通過。**staging 未執行** |

### O05 本機負載結果（2026-10-23，production build，非 staging）

條件：`npm run load-test`，30 位團隊成員、每情境 60 秒、本機 PostgreSQL 16 與 `next start`（同一容器）。延遲只計成功請求。重試規則與 UI 一致：409 `order_changed` 重新載入看板後在同一位置再放一次（最多一次）；409 `card_changed` 不重試。舊版對照為 commit aa2d44f（移動檢查整張看板 revision，409 無 reason，腳本一律視為可重放一次），同腳本、同資料庫初始狀態。

**正常操作頻率**（每人每輪：列表、Schedule 讀取＋指令、看板、移動自己的卡到隨機欄位與位置、通知；每輪間隔 2–6 秒）

| 操作 | 次數 | 成功率 | 409 | p50 ms | p95 ms | max ms |
| --- | --- | --- | --- | --- | --- | --- |
| feedback.list | 434 | 100% | 0 | 16 | 25 | 61 |
| schedule.get | 434 | 100% | 0 | 9 | 15 | 32 |
| schedule.command | 434 | 100% | 0 | 21 | 38 | 54 |
| roadmap.board | 434 | 100% | 0 | 15 | 24 | 65 |
| roadmap.move（首次） | 434 | 99.1% | 0.9%（order_changed 4、card_changed 0） | 24 | 49 | 106 |
| roadmap.move（重新放置） | 4 | 100% | 0 | 26 | 27 | 27 |
| notifications.list | 434 | 100% | 0 | 9 | 15 | 43 |

| 移動結果（每次拖曳意圖） | 意圖 | 首次成功 | 重試後成功 | 最終成功率 | 仍衝突 |
| --- | --- | --- | --- | --- | --- |
| 本版 | 434 | 430 | 4 | **100%** | 0 |
| 舊版 aa2d44f | 431 | 312 | 94 | 94.2% | 25（首次 409 比例 27.6%） |

**高競爭**（無間隔，只做拖曳；70% 落在同一欄、位置集中在前 6 格；20% 拖曳 3 張多人共用的熱門卡）

| 操作 | 次數 | 成功率 | 409 order_changed | 409 card_changed | p50 ms | p95 ms | max ms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| roadmap.board | 3370 | 100% | 0 | 0 | 220 | 290 | 379 |
| move 不同卡片（首次） | 2712 | 67.8% | 873 | 0 | 182 | 269 | 371 |
| move 不同卡片（重新放置） | 873 | 62.7% | 326 | 0 | 196 | 267 | 339 |
| move 共用熱門卡（首次） | 658 | 40.0% | 117 | 278 | 184 | 269 | 380 |
| move 共用熱門卡（重新放置） | 117 | 40.2% | 29 | 41 | 207 | 265 | 324 |

| 移動結果（每次拖曳意圖） | 不同卡片：本版 | 不同卡片：舊版 | 共用熱門卡：本版 | 共用熱門卡：舊版 |
| --- | --- | --- | --- | --- |
| 意圖 | 2712 | 2577 | 658 | 650 |
| 最終成功率 | **88.0%** | 6.8% | 47.1% | 5.8% |
| 首次 409 比例 | 32.2% | 95.8% | 60.0% | 96.5% |
| 同卡衝突（不重試，使用者重新載入） | 0 | — | 319 | — |

解讀：不同卡片不再因整張看板 revision 互斥；高競爭下剩餘的 `order_changed` 是使用者選的相鄰卡在讀取看板到送出之間真的被別人移走或換序（約每秒 50 次拖曳集中在同一欄前 6 格的極端情境），依規則不自動套用。共用熱門卡的 `card_changed` 是真正的同卡衝突，維持 409。

負載後不變量（兩情境、本版與舊版皆檢查）：未刪除 Feedback 數＝排序紀錄數＝看板計數＝看板卡片數（30／63），看板無重複卡片、分類錯誤 0（每筆排序紀錄的欄位與 Feedback 狀態一致）、同欄 rank 並列 0、重複建立 0；本版每張卡的 placement revision 增量＝成功移動次數（不一致 0）。
