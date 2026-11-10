# Feedback 詳情與留言：AI 交接包

本包是目前已確認版本的原始碼快照，取代舊版「新增 Feedback 表單」作為這次交接依據。它不是完整的 Next.js 或 Vite 專案，也不是已接後端的留言系統。

## 交給 AI 的方式

1. 請 AI 先讀 `AI_HANDOFF.md`，再讀 `STYLE_SPEC.md`。
2. 以 `source/App.tsx`、`source/index.css` 為程式碼依據，以兩張截圖為視覺參考。
3. 要求 AI 整合到目標專案既有的 Feedback 詳情彈窗，不要重新做回新增表單。
4. 若平台只能上傳單一文字檔，改用另附的 `feedback-detail-ai.md`，內含指令、規格與完整兩份原始碼。

## 內容

| 檔案 | 用途 |
| --- | --- |
| `AI_HANDOFF.md` | 可直接交給 AI 的任務、限制及整合注意事項 |
| `STYLE_SPEC.md` | 目前確認的版面與互動規格 |
| `source/App.tsx` | 目前 React 元件原始碼，未修改、未轉譯 |
| `source/index.css` | 目前完整樣式原始碼，含原預覽頁的全域設定 |
| `reference-desktop.png` | 1280 × 900 桌面預覽，按讚初始值為 0 |
| `reference-mobile.png` | 390 × 844 手機預覽，按讚初始值為 0 |
| `MANIFEST.json` | 原始碼及交接內容的 SHA-256，用於檢查檔案完整性 |

## 環境與驗證範圍

來源使用 React 19、TypeScript 5.7、Vite 8、Tailwind CSS 4，未直接安裝 shadcn/ui 或 Radix UI。shadcn Message 是版面參考，不是此快照的執行依賴。

之前指定的接收環境是 Next.js 16.4.2、React 19.3.1、TypeScript、Tailwind CSS 4、shadcn/ui／Radix UI；本包不要求升降級任何依賴，也未在接收方專案建置。

目前來源已通過型別、建置、按讚互動、時間位置及 320／390／768／1280px 排版檢查。整合後仍須執行接收方自己的驗證指令。

本次僅打包交接內容，不修改目前畫面，也不覆寫舊版交接包。
