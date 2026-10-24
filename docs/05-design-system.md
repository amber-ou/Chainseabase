# Design System 與畫面規格

## 設計來源與方向

使用使用者指定的 [taste skill](https://github.com/leonxlnx/taste-skill/blob/6010f91a9935f1c167dfc500fb1a475681892e6b/skills/taste-skill/SKILL.md) 與其 app-screens 指引，不套用行銷頁的巨大標題、圖片數量或捲動動畫要求。

- 固定 skill commit：`6010f91a9935f1c167dfc500fb1a475681892e6b`。
- seed：`20261023`；kind：`workspace`；theme：`light`。
- 候選為 Achromatic ledger、Editorial greeting；選擇 **Achromatic ledger**，原因是使用者需長時間整理回饋與表格，低彩度框架比歡迎式首頁更適合。
- 採用 open-plane、有標籤側邊欄、近黑主要按鈕、白色資料表面；未重新抽樣（redraw=0）。
- 產品識別：偏冷的淺灰背景、Chainseabase 字標與開口相扣的雙環線條符號；核心特色是「五職掌 Schedule」與唯一分欄卡片，不以假 KPI 建立識別。
- 原始方向資料：[taste-direction.json](design/taste-direction.json)。

產生方向使用以下命令（`<skill>` 指外部 taste skill 目錄，並非已安裝到本專案的依賴）：

```bash
node <skill>/scripts/draw.mjs --app --kind workspace \
  --brief 'Chainseabase: Traditional Chinese internal product feedback workspace for 30 teammates; status roadmaps, private personal boards, five-column PO UIUX frontend backend QA schedule, shared Google calendar' \
  --screens overview,list,detail,settings --theme light --seed 20261023 \
  --style achromatic-ledger --out <planning-directory>
```

規劃階段只完成方向與元件規格；實作後的 lint／inspector 結果記錄在 [驗收追蹤報告](acceptance-report.md) V04。Featurebase 用作資訊配置參考，最終互動以本文件及已確認需求為準。

### 產品需求優先的調整

1. 原方向以少量色彩為原則，但需求要求 Roadmap／Personal 不同色與指令成功色，因此在工作區識別小標記與資料狀態使用藍／青綠／成功綠；不染整片側邊欄或每張卡片。
2. 加入 Noto Sans TC 作繁體中文主體字形，保留 Geist 的拉丁文字；不增加裝飾字型。
3. 依資料密度採 44px 列與 14px 本文，不為追求 sparse 風格藏掉必要控制。
4. 控制邊框與 focus 提高對比；裝飾性細線可保留低對比。
5. 側邊欄依使用者指定八項順序，不採 skill 的任意工具重排。
6. 原方向數據卡／設定範本的尺寸不是硬性頁面需求；不加入 KPI、付費方案或使用量。

## Tokens

工程規格示例，不是已匯入應用的 CSS：

```css
:root {
  --ground: #f2f4f7;
  --surface: #ffffff;
  --raised: #eeeeee;
  --active: #e7eaee;
  --border: #e6e6e6;
  --rule: #f0f0f0;
  --control: #858585;
  --text: #0a0a0a;
  --muted: #6b6b6b;
  --primary: #141414;
  --on-primary: #ffffff;
  --roadmap-accent: #1d5fbf;
  --personal-accent: #0f766e;
  --focus: #1d5fbf;
  --positive: #2e7d32;
  --positive-bg: #dcfae5;
  --negative: #c4242a;
  --negative-bg: #ffedea;
  --warning: #92400e;
  --warning-bg: #fffbeb;
  --radius-card: 8px;
  --radius-control: 6px;
  --radius-chip: 4px;
  --sidebar-width: 256px;
  --gap: 12px;
  --pad: 24px;
  --row-height: 44px;
  --control-height: 36px;
  --font: "Geist", "Noto Sans TC", system-ui, sans-serif;
  --fs-title: 24px;
  --fs-section: 16px;
  --fs-body: 14px;
  --fs-small: 12px;
}
```

- 字重 400／500；頁面標題 24px/500，區塊標題 16px/500，本文 14px/400、行高 22px，輔助文字 12px/400、行高 18px。
- 數字使用 tabular-nums；程式碼與真實 ID 可使用系統等寬字，不把整個介面變成終端機。
- 文字對比至少 4.5:1；focus 與重要控制界線至少 3:1。disabled 以文字解釋原因，不把整個元件透明化到不可讀。
- 間距以 4px 為基底；常用 8／12／16／24／32。相鄰欄位與卡片使用一致 12px gap。
- 所有常態表面不加陰影；Dropdown、Modal、Popover 才使用有限浮層陰影。
- 不使用漸層、玻璃效果、彩虹卡片、emoji 導覽或假統計。

## 共用元件

| 元件 | 必要狀態／互動 |
| --- | --- |
| Button | default、hover、focus、pressed、pending、disabled；pending 避免連點但保留文字。 |
| Dropdown／Combobox | 搜尋、空結果、單選／複選、鍵盤方向鍵與 Escape；選中值不只用顏色。 |
| Tag | 顯示所屬群組；單選替換、複選增減；不可把版本 Tag 當一般自由文字。 |
| Modal | 正確 dialog 語意、標題、焦點循環、關閉後還原焦點、未儲存提示。 |
| Confirm Modal | 明確說出影響對象與後果，取消為安全預設，確認按鈕標示實際動作。 |
| Tabs | 鍵盤可切換，選中狀態以文字＋底線，長列只在容器內捲動。 |
| Avatar | 真實頭像；缺少時以姓名字首的穩定中性色替代，不使用隨機假人像。 |
| Comment | 頭像、名稱、正文、相對時間、按讚、引用回覆、編輯狀態。 |
| SaveStatus | 儲存中／已儲存／失敗與重試；aria-live，不連續跳出干擾 toast。 |
| EmptyState | 短句與可執行下一步，保留必要框架；沒有資料不顯示假數字。 |
| ErrorState | 在失敗區塊顯示原因與重試，不因一個區塊失敗清空整頁。 |

## 後台 Shell

- 桌面 1440px：256px 側邊欄＋1184px 主區；主區左右各 24px，內容寬 1136px。一般三欄板可用 `(1136 - 2×12) / 3`，五欄看板採固定最小欄寬並水平捲動，不擠小字。
- 頂部品牌與產品範圍清楚可見；產品切換入口在 Product 與共用產品選擇器一致。
- 側邊欄為淺灰，選中項中性灰背景，不放大面積品牌色。
- 主區頁首包含 h1 與必要操作。搜尋只放 Feedback 等實際需要處，不建立空白頂部工具列。
- 每頁主要問題與動作如下。

| 頁面 | 首先回答的問題 | 主要操作 |
| --- | --- | --- |
| Product | 我正在管理哪個產品，近期有什麼活動？ | 切產品／新增活動。 |
| Feedback | 哪些需求需要處理？ | 新增 Feedback。 |
| Roadmap | 各階段有哪些需求？ | 拖曳／移至欄位。 |
| Personal | 這位負責人的工作，我如何整理？ | 切負責人／新增欄。 |
| User | 哪些成員能使用產品、負責什麼？ | Email 邀請。 |
| Notification | 有哪些與我相關的新事件？ | 開啟內容／標記已讀。 |
| Setting | 如何管理個資、分類與職掌？ | 儲存對應設定。 |

## Feedback Modal

- 桌面最大寬度約 1120px，至少保留視窗兩側 24px；一般內容可內縮閱讀，Schedule 使用完整寬度。
- 頂部建立者頭像、名稱與建立時間；標題與描述；功能列兩排固定語意。
- 第一排：狀態／類別／Person tag；第二排：優先級／版本／＋標籤。
- Personal 開啟時第三排顯示本人個人 Tag，清楚標示「僅自己可見」。
- 頂層 Tab 為「內容」「Schedule」；內容保留普通留言，無 Insight。
- 新增時底部「新增多筆」與建立按鈕；編輯時採明確儲存表單，不與 Personal 自動儲存標示混用。
- 公開 Feedback 的一般留言輸入框顯示「此留言會公開顯示」；Schedule 顯示內部範圍文字。
- 中斷與錯誤保留輸入；表單頂部與錯誤欄位都有訊息，不只 toast。

## Schedule 五欄畫面

```text
Schedule
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ PO       │ UIUX     │ 前端     │ 後端     │ QA       │
├──────────┼──────────┼──────────┼──────────┼──────────┤
│          │          │ /2-3     │          │          │
│          │          │ 頭像 姓名│          │          │
│          │          │ 工作內容 │          │          │
│          │          │ 日期     │          │          │
└──────────┴──────────┴──────────┴──────────┴──────────┘
＋ 新增一排

留言區  ｜ 操作歷史紀錄
引用／留言列表或操作事件列表
[/2-3 填寫內容…                               ] [送出]
```

- 五欄等寬，建議單欄至少 180px，表格最小寬度 900px。表頭 40px、初始內容列至少 96px；列高隨最多內容的格子增加。
- 使用真正 table 語意與欄標題。可操作格子提供 button／可聚焦控制及清楚 accessible name，例如「第 2 列，前端」。
- 空格留白並在 hover／focus 顯示「填寫」與座標；不讓每格出現大型空狀態卡片。
- 選中格以清楚 focus ring 與文字座標表示，表頭不可選。
- 每筆資料為小型垂直內容群：24px 頭像、姓名、換行文字、YYYY-MM-DD；多筆以間距與細線區分，不套彩色大卡。
- 輸入框只一個；先顯示目標座標再填內容。明確顯示「送出」，不可只靠 Enter；工程預設 Ctrl/Cmd+Enter 送出，Enter 換行。
- 成功命令用綠色文字＋勾選，區分「已套用至草稿」「已寫入 1 筆」「已清空 3 筆」。錯誤保留原文與選取格。
- 歷史每列頭像、操作者、目標、摘要、相對時間與移除控制，移除圖示有文字 tooltip／accessible name。
- 清空指令確認：輸入完整 delete 指令本身即表達清空；歷史移除一定另有確認 Modal。若新增快捷清空按鈕，必須先提示將清空幾筆。

## Roadmap／Personal

- 共用卡片元件，Roadmap 以藍色小標記，Personal 以青綠小標記及明確頁名區分；不只依顏色辨識。
- 欄寬桌面預設 280px、gap 12px；五欄最小寬度 1448px，在板內容器水平捲動。Tab 列與卡片板分別捲動，不讓整頁橫向溢出。
- 卡片顯示標題、建立者與必要分類資訊，不顯示過量標籤；可展開查看全部。
- 欄頭顯示名稱與伺服器計算的筆數，不用載入頁面長度假冒總數。
- 拖曳時提供目標位置、pending、失敗回復，並以 aria-live 宣告移動結果。
- 所有卡片另提供「移至欄位／上移／下移」選單，觸控與鍵盤使用者不必精準拖曳。
- Roadmap 建立 Modal 先選維度；Tag 群組選單只列 single，告知多選群組不適用。
- Personal 不顯示條件編輯器。新增欄位只填名稱；刪欄提示卡片將移回預設欄。

## Product 日曆

- 產品名稱與切換在上；主要內容為日曆工具列、月／週／活動清單切換、今天、前後期與新增活動。
- 月曆高密度格子有「更多」入口，不能把活動文字壓到不可讀。全天活動與有時間活動分區。
- 週視圖呈現小時與時區，活動可以拖曳改時間，另有 Modal 作完整可及替代。
- 編輯 Modal 包含名稱、日期時間／全天、時區、地點、說明、重複設定與 Feedback 關聯。
- 重複活動編輯／刪除先選「本次」或「整個系列」，清楚列出影響；沒有「本次及之後」假入口。
- 授權未連結、無權限、只讀、到期、網路錯誤、日期窗無活動都分開呈現。
- 不以 Google iframe 實作核心編輯；外部「在 Google 開啟」僅作補充入口。

## 前台網站

- 使用相同字體與元件，但採簡潔頂部產品名稱、Feedback／Roadmap 導覽與登入控制，不保留後台 sidebar。
- 匿名訪客可瀏覽與搜尋公開內容；按投票、留言或新增時，提示登入；登入後若未受邀，顯示缺少該產品互動資格，不假裝加入成功。
- 前台 Feedback 仍以 Modal 開啟；沒有 Schedule、私人 Tag、內部欄位或內部 API 呼叫。
- 只有選擇公開的狀態 Roadmap 可見；卡片不提供拖曳。

## 響應式與完整狀態

| 寬度 | 規則 |
| --- | --- |
| 1440px | 完整 sidebar、列表與板；Schedule 表格完整寬度。 |
| 768px | sidebar 折疊為選單；Modal 寬度接近畫面；板與表格在自身容器捲動。 |
| 390px | 48px 頂部列、16px 邊距；Modal 使用全螢幕；觸控目標 ≥44px；日曆預設活動清單。 |

手機 Schedule 仍維持五欄與座標，容器橫向捲動，表頭與選中目標可識別；不把五欄改成另一套座標。按讚、回覆、移除均可鍵盤／觸控操作。

各畫面必須覆蓋 loading、empty、partial-error、permission-denied、saving、conflict；資料刷新保留已顯示內容並標示刷新，不整頁閃空白。尊重 prefers-reduced-motion，動畫只用於操作回饋，不用入場動畫阻擋閱讀。

## 實作後設計驗證

1. 以真實可辨識的測試資料檢查列表、長標題、多筆同格與空狀態，不使用虛構商業績效。
2. 依固定 skill 版本執行 app lint 與 inspector，涵蓋 1440／768／390；新增的產品必要例外逐項記錄，不隱藏失敗。
3. 開啟每張最後版本截圖，修正溢出、焦點、低對比、文字截斷與多餘空間。
4. 自動化與人工驗證 Modal focus、鍵盤拖曳替代、螢幕閱讀器表格標題與成功／錯誤宣告。
5. 確認 Google 活動、公開前台與私人資料使用正確資料來源；漂亮假資料不算功能驗收。
