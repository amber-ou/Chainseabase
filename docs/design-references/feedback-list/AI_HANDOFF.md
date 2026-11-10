# Feedback List UI — AI Handoff

## 交付目的

這是一份可整合到既有網站框架的樣式參考包。它描述目前 Figma Make 頁面的視覺語言、資料表結構與拖曳行為，不應被視為完整產品頁面或資料層。

## 檔案

- `FeedbackListStyle.tsx`：React 外觀與拖曳參考元件。
- `feedback-List.css`：元件實際樣式與 CSS Design Tokens。
- `STYLE_SPEC.md`：尺寸、間距、色碼、響應式與驗收規格。
- `AI_HANDOFF.md`：修改範圍、限制與整合方式。

## 修改範圍

整合 AI 可以：

1. 將 `FeedbackListStyle` 的結構映射到既有頁面、路由或資料模型。
2. 以專案既有 icon 元件替換範例內的 inline SVG。
3. 將範例資料改接 API、CMS、Store 或 Server State。
4. 將 HTML5 Drag and Drop 換成專案既有拖曳函式庫，但視覺與行為需符合 `STYLE_SPEC.md`。
5. 依專案命名規範重新命名 class，但必須保留 `feedback-list-style` 根節點的樣式隔離概念。

## 限制

1. **唯一產品互動是拖曳。**
   - 群組標題可拖曳調整群組順序。
   - 資料列可在同群組內排序，也可跨群組移動。
2. 工具列按鈕、搜尋框、箭頭、負責人欄位在此包中皆為靜態視覺參考。
3. 不要自行加入新增、搜尋、篩選、展開收合、下拉選取、刪除、編輯、分頁或儲存互動。
4. 不要加入外部 UI、icon、拖曳或 CSS 套件，除非宿主專案已經使用。
5. 不要把範例的 `initialGroups` 當成正式資料來源。
6. 不要更改既有網站的全域 reset；本 CSS 已以 `.feedback-list-style` 命名空間隔離。

## 整合方式

1. 複製 `FeedbackListStyle.tsx` 與 `feedback-List.css` 到宿主專案合適位置。
2. 確認 CSS import 的大小寫完全一致：

   ```tsx
   import "./feedback-List.css";
   ```

3. 由宿主容器提供可用寬度；元件會填滿容器。
4. 表格最小寬度為 `1000px`，空間不足時允許水平捲動，但隱藏原生滾軸。
5. 若宿主專案使用 Tailwind、CSS Modules 或 CSS-in-JS，請逐項搬移 `feedback-List.css` 的 token 與規格，不要只近似套用。
6. 若資料更新需持久化，請在拖曳完成後由宿主層送出排序結果；參考元件只更新本地 state。

## 拖曳資料契約

建議正式資料至少包含：

```ts
type FeedbackGroup = {
  id: string;
  name: string;
  tone: "blue" | "sand";
  items: FeedbackItem[];
};

type FeedbackItem = {
  id: string | number;
  title: string;
  description: string;
  tags: string[];
  role: string;
  comments: number;
  updatedAt: string;
};
```

群組與資料列必須使用穩定 ID，不可使用陣列 index 作為 React key。

## 無障礙注意事項

- 正式整合若需要鍵盤拖曳，應由宿主專案補上鍵盤排序模式與即時區域提示。
- 靜態裝飾 icon 使用 `aria-hidden="true"`。
- 拖曳後需維持可預測的焦點位置。
- 文字與背景對比不可低於目前 token 所提供的對比。

## 不應修改目前 Make App

此資料夾是交付參考，不會自動接入 `src/App.tsx`。若要讓目前 Make App 改用此元件，必須另行確認後再進行。
