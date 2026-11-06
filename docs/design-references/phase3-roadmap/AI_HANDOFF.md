# Roadmap 樣式交接給 AI

## 先讀這段

這是**目前 Roadmap 整頁**的可執行樣式參考，不是彈窗，不是 Linear 全站複製，也不是完整產品功能。使用者已確認只保留：

1. 卡片跨欄拖曳、來源卡片半透明、目標欄位高亮、放下後數量／狀態圖示更新。
2. 看板溢出時的左右箭頭、滾輪／觸控板水平捲動；保留真正的捲動容器，但**不顯示捲軸**。
3. 上述捲動的鍵盤等效操作與減少動態效果偏好。

**不要實作**新增／刪除／編輯卡片、Tab 切換、搜尋、篩選、選單、發佈切換、登入、API、資料庫或持久化。這些控制項只保留目前外觀，程式刻意設為 `disabled`。

## 四個檔案

| 檔案               | 職責                                             |
| ------------------ | ------------------------------------------------ |
| `AI_HANDOFF.md`    | 範圍、限制、整合順序與資料契約                   |
| `RoadmapStyle.tsx` | 獨立 React + TypeScript 元件、SVG 圖示與兩類互動 |
| `roadmap.css`      | 實際 CSS、命名空間與 Design Tokens               |
| `STYLE_SPEC.md`    | 尺寸、間距、色碼、狀態、驗收清單                 |

**優先順序：**使用者後續明確要求 > 本次互動白名單 > `STYLE_SPEC.md` 的驗收條件 > 元件與 CSS 的具體實作。不要因為按鈕看起來可按，就自行新增產品流程。

## 整合方式

適用 React 18/19、TypeScript、可載入 CSS 的前端打包器。除了 React / React DOM，不依賴 Tailwind、圖示套件、圖片、字型服務或拖曳套件。

```text
src/roadmap/
  RoadmapStyle.tsx
  roadmap.css
```

```tsx
import RoadmapStyle from "./roadmap/RoadmapStyle";

export default function Page() {
  return <RoadmapStyle />;
}
```

- 元件自行載入同資料夾的 `./roadmap.css`，無需複製原專案 `src/index.css`。
- 所有 CSS 選擇器都限定 `.roadmap-style`；不要搬成 `body`、`:root` 或全域 `button` 的規則。
- 宿主頁面自行處理 `body { margin: 0; }`；交接樣式不重設元件外部頁面。
- 元件設計為完整頁面；已有側欄時，把它放在 `min-width: 0` 的主要內容容器中。
- Flex/Grid 宿主的主要內容子項也必須 `min-width: 0; max-width: 100%`，不可讓內部 1665px 看板把整頁撐寬。
- 頂部控制列保留原桌面寬度與比例；≤800px 時會裁切超出部分，而不是擅自改成另一套手機版工具列。看板本身保留 16px 留白並可捲到每一欄。
- 本參考不是 Next.js 專用檔。若整合到已有的 Next.js App Router，需在元件檔加入 `"use client"`，並依宿主規範載入 CSS；不要把瀏覽器互動改成伺服器功能。
- 字型使用系統堆疊，不宣稱內附 Inter 字型檔；若宿主已有 Inter，直接沿用。中文字需宿主瀏覽器有支援的 CJK 字型。

## 資料契約

```tsx
import RoadmapStyle, { type RoadmapCard } from "./roadmap/RoadmapStyle";

const cards: RoadmapCard[] = [
  {
    id: "1132",
    title: "1132",
    columnId: "done",
    label: "需求討論",
    owner: "歐瑜",
    showOwnerAvatar: false,
  },
];

<RoadmapStyle
  initialCards={cards}
  onCardMove={(move) => {
    // 可選的前端通知，不代表已寫入後端。
    console.log(move.cardId, move.fromColumnId, move.toColumnId);
  }}
/>;
```

- 欄位順序固定：`pool` 需求池 → `progress` 進行中 → `done` 已完成 → `discussion` 待討論 → `delayed` 延後。
- `id` 必須在同一看板中唯一；`columnId` 必須是上列五種值。
- `label` 是卡片標籤，**不是欄位狀態**。拖曳只變更 `columnId`，不得覆寫 `label`、標題或負責人。
- `showOwnerAvatar` 預設不顯示；範例 `1132` 的頭像已依使用者要求移除，負責人文字仍保留。其他資料可明確傳 `true`。
- `initialCards` 只在掛載時讀取；本元件不是受控資料表。需要重設示範時可變更 React `key` 重新掛載。
- `onCardMove` 只在有效的跨欄移動時呼叫一次；放回原欄、無效拖曳不觸發。
- 狀態僅在 React 記憶體內，重新整理會還原；不可聲稱已儲存。
- 每個元件有獨立 `useId`，拖曳 payload 也含看板 ID；不同看板之間不互相接收卡片。

## 實作邊界

### 可調整

- 以根節點 `style` 或較後載入的 `.roadmap-style` 規則覆寫 `--rm-*` Tokens。
- 在不突破互動白名單的前提下，映射宿主資料到 `RoadmapCard`。
- 將 JSX 搬入既有路由／頁面，或替換成宿主的等價純展示元件。

### 不可自行變更

- 卡片至少 300px；欄位至少 333px，不能為了塞進畫面縮窄。
- 白底只在看板內，頁面左右保留空間；五欄零間隙，用四條灰色直線分隔。
- 不恢復「（狀態）」／「（類別）」Tab 附註，不重新收合右側欄位。
- 不把 disabled 展示控制項接上事件，不恢復卡片標題輸入框。
- 不啟動新開發伺服器或覆寫宿主入口檔；本次交接不修改原本的運作頁面。

## 技術限制與測試

- 拖曳採瀏覽器標準 HTML5 Drag and Drop，以桌面瀏覽器為目標。本次實測為 Chromium；Firefox / Safari 需於宿主整合後再驗證，不宣稱已支援手機手指拖卡。
- 觸控裝置可原生水平捲動；若要觸控／完整鍵盤卡片拖放，先另行確認需求，不擅自新增流程或套件。
- 捲動容器可聚焦，支援左右鍵、Home / End；箭頭有名稱、邊界停用狀態。
- `Ctrl + wheel` 不攔截；無溢出或已到對應邊界時，不攔截一般垂直滾輪。
- 捲動與 ResizeObserver 事件都有清理，支援 React StrictMode。
- 交付前依 `STYLE_SPEC.md` 驗收；不能只用 build 成功代替互動測試。

### 本次交付驗證

- 獨立 TypeScript 檢查通過，元件沒有依賴原 App 的型別或狀態。
- 使用獨立 HTML 頁面載入元件，沒有載入原頁面的 CSS 或 Tailwind。
- Chromium 中通過 25 項檢查：主要尺寸與留白、控制項停用、拖曳視覺與資料保留、箭頭邊界、真實滾輪與水平輸入、響應式裁切、減少動態效果、雙看板隔離、StrictMode 掛載／卸載及無執行例外。
- 本次未改動原本的 `src/App.tsx`、`src/index.css` 或入口路由；交接包與原頁面分開。
