# 目前確認的視覺與行為規格

## 詳情內容

| 項目 | 目前值 |
| --- | --- |
| 桌面預覽寬度 | 螢幕至少 1000px 時，最大 894px |
| 桌面預覽圓角 | 8px；整合時保留正式彈窗原有值 |
| 預覽頁背景 | `#eef1f5`；正式應用不必套用 |
| 彈窗背景 | `#ffffff` |
| 內容 padding | 桌面 `28px 24px 24px`；640px 以下 `24px 18px` |
| 標題 | 21px／600／1.5／`#313341`；640px 以下 19px |
| 描述 | 13px／1.85／`#555967`，上方 margin 10px，無固定高度 |
| 膠囊 | 四顆，高 32px，圓角 999px，gap 8px，上方 margin 20px |
| 標籤預設 | 只有「＋」，灰底 `#f4f5f7`，無邊框 |

## 留言區

- 分隔線：`1px solid #eeeff2`。
- 最終 top padding：12px，由 JSX 的 inline style 覆蓋 CSS 預設 22px。
- 左右 padding：24px，640px 以下為 18px；下方 24px。
- 標題「留言」：13px／600，旁邊數量 2；標題列 row-gap 8px、column-gap 0px。
- 留言列表：上方 margin 20px，兩則之間 gap 20px。
- 指定兩則 article：flex、`align-items: center`、`justify-content: flex-start`、gap 10px。
- 頭像：28 × 28px，圓形，設計團隊淡紫、歐瑜淡綠。
- 名稱：11px／500／`#6b7080`，下方 margin 6px。
- 氣泡：背景 `#f4f5f7`，圓角 10px，padding `10px 13px`，13px／1.8／`#555967`。
- 氣泡指定的 inline 值：`align-items: flex-end`、`justify-content: flex-start`、`gap: 8px 12px`、`column-gap: 12px`。氣泡是 block，這些 flex／gap 值目前沒有子項排列效果。
- 氣泡與時間的外層：flex、垂直置中、gap 8px。
- 時間：10px、line-height 18px、`#9295a0`、不換行、不可縮小，位於氣泡右側。
- 範例時間：設計團隊 `2026/11/06 11:26`、歐瑜 `2026/11/06 11:30`，語意值含 `+08:00`。
- 640px 以下（Tailwind max-sm）：article 可換行，內容可伸展，按讚／回覆列獨占一列並靠右。
- 注意 Tailwind `max-sm` 是小於 640px；來源 CSS 的手機 media query 是小於等於 640px，保留來源實際邊界，不自行統一。

## 按讚／回覆

| 項目 | 設計團隊 | 歐瑜 |
| --- | --- | --- |
| 初始數量 | 0 | 0 |
| 點擊後 | 1，再點回 0 | 1，再點回 0 |
| 未按讚文字／圖示 | `#9295a0` | `#9295a0` |
| 按讚後文字／圖示 | `#8071b4` | `#8071b4` |
| hover 底色 | `#f4f5f7` | 無 |
| 按讚後底色 | `#f3f0fa` | 無 |
| 按讚後圖示 | 線框 | 實心 |
| 回覆 | 圖示停用預覽 | 圖示停用預覽 |

- 按讚控制高 28px，圖示 16px；數量為 tabular numerals。
- 兩則各自使用原生 checkbox，透過 peer／checked 樣式顯示 0 或 1，沒有共享狀態或持久儲存。
- 鍵盤 focus 輪廓保留，不應因「無底色」而刪除可及性焦點。

## 留言輸入框

- 上方 margin 24px，1px `#e7e8ed` 邊框、10px 圓角、`#fafafb` 背景。
- textarea：readOnly、最小高度 82px、padding `13px 14px 0`、13px／1.8。
- 工具列：垂直置中、靠右；左側圖片按鈕透過 `margin-right: auto` 靠左。
- 工具列 padding：`10px 12px 12px 14px`，gap 12px。
- 圖片按鈕：30 × 30px，5px 圓角、灰底、18px 圖示，停用預覽。
- 送出鍵：30 × 30px，圓形、`#e6e1f2` 底色、`#a598c6` 圖示，停用預覽。
- 不顯示原已刪除的提示文字，不增加其他格式工具或附件流程。
