# 給實作 AI 的指令

請將這個資料夾的「純樣式」套用至目標專案中既有的整個 Feedback 彈窗。

## 技術背景

- 目標：Next.js 16.4.2、React 19.3.1、TypeScript。
- 樣式：Tailwind CSS 4＋共用 CSS／Design Tokens。
- 元件：shadcn/ui＋Radix UI。
- 本包的 TSX 只是靜態外觀範例，不是要取代正式功能的完整元件。

## 開始前

1. 先讀目標專案的 AGENTS／README、字型與 Design Token 規範。
2. 找出既有 Feedback 彈窗及其組成元件，確認既有 UI 結構和樣式合併方式。
3. 讀本包 `STYLE_SPEC.md`、`feedback-dialog.css`、`FeedbackDialogStyle.tsx`，可打開 `preview.html` 比對。
4. 只處理這顆 Feedback 彈窗，不修改其他 Dialog、Button、Select、Switch 或全域 theme。
5. 如果現有架構無法只改樣式、需要改動資料或功能，先說明並詢問使用者，不要自行擴大範圍。

## 必須保留

- 最外層既有圓角不變。不得以 `rounded-2xl` 或其他「更像參考圖」的值替換。
- 保留既有開關狀態、focus trap、Esc、overlay、Radix Portal、關閉行為及 dialog 可及性。
- 保留既有資料流、文字編輯、驗證、選單選項、圖片處理及送出行為。
- 不新增 API、不上傳、不儲存、不安裝新套件。
- 不把靜態範例裡的 `disabled`、示意作者／時間或純文字膠囊帶入正式功能。

## 外觀修改順序

1. 標題列：13px 半粗文字、右側關閉符號，底部 `1px solid #e5e7eb` 分隔線。
2. 內容自然撐高，不指定 699px 高度或滿螢幕高度。
3. 標題與描述：無框、無輸入框背景，文字與 placeholder 都為 `#999999`。
4. placeholder 必須是提示，不是預填內容：`請輸入標題`、`簡短描述建議或是Bug`。
5. 描述下方圖片 icon：30×30px、5px 圓角、`#f4f5f7` 灰底；不要加可見的「新增圖片」文字。
6. 圖片按鈕與膠囊列間距 8px；膠囊列本身 gap 8px、下方 padding 16px。
7. 只保留狀態、類別、Person tag、加入標籤四個膠囊，高度統一為 32px。不顯示優先級／版本。
8. 加入標籤的預設外觀僅顯示「＋」，無虛線、灰底、高度 32px；既有選取後的標籤顯示行為不變。
9. 作者／時間放在膠囊下方，top padding 8px、bottom padding 20px。
10. Footer 左側新增多筆；右側取消（灰底）與建立（黑底 `#000000`、白字），皆為膠囊按鈕。Footer 按鈕維持 29px 高，圖片按鈕維持 30px，不要把這次膠囊的 32px 高度擴大套用到其他按鈕。建立按鈕 hover 也保持黑底。
11. 不恢復 Tab、公開範圍、Markdown 說明文字或舊的三欄灰色設定區。

## 與 shadcn/ui 對應

| 正式元件／區塊               | 本包 class                                                    | 注意事項                                                                                 |
| ---------------------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DialogContent` 或既有最外層 | `fbk-scope fbk-dialog`                                        | 保留既有 radius／position／transform；消除原本多餘的 p／gap，最大內容寬度以 894px 為參考 |
| `DialogHeader`               | `fbk-header`                                                  | 改成橫列，保留正常的關閉按鈕定位                                                         |
| `DialogTitle`                | `fbk-heading`                                                 | 不要移除可及性的標題關聯                                                                 |
| 內容區                       | `fbk-body`、`fbk-content`                                     | 避免重複 padding                                                                         |
| 既有標題／描述編輯器         | `fbk-title`、`fbk-description`                                | 保留編輯功能，不要真的換成空的靜態 div                                                   |
| 圖片 icon trigger            | `fbk-image-button`                                            | 保留現有 aria-label／tooltip 與事件                                                      |
| 既有圖片縮圖列／單張／移除   | `fbk-image-previews`／`fbk-image-preview`／`fbk-image-remove` | 僅套縮圖樣式，不能帶入選圖或上傳邏輯                                                     |
| 膠囊 trigger                 | `fbk-pill`＋對應 modifier                                     | 若 `SelectTrigger` 自帶 Chevron，只保留一個                                              |
| 加標籤 trigger               | `fbk-pill fbk-pill-add`                                       | 32px 高，無邊框，預設僅有 plus                                                           |
| `Switch` 的 Root／Thumb      | 參考 `fbk-switch`／`::after` 數值                             | Radix 已有 Thumb，不要再加第二顆 `::after` 圓點；保留 `data-state`                       |
| `DialogFooter`               | `fbk-footer`                                                  | 全寬分隔線、左開關／右按鈕                                                               |
| `Button`                     | `fbk-action fbk-cancel`／`fbk-create`                         | 保留取消與送出原本語意及事件                                                             |

本包沒有把 shadcn 的匯入路徑或組件版本寫死，請依目標專案現有公共 API 整合。Tailwind v4 版本的 shadcn 元件可能附帶 `sm:max-w-*`、`p-6`、`gap-4`、`h-*`、`shadow-*`、`[&_svg]:size-*` 等預設；只在這顆實例解決衝突，不要修改共用元件原始碼。

`fbk-title:empty::before` 等規則只示範空內容的 placeholder 外觀。若目標專案已有可靠的 placeholder／editor 插槽，優先沿用其 API；不要為了樣式更換編輯器。

## 完成後驗證

- 對照 `STYLE_SPEC.md` 每一項驗收。
- 檢查桌面、390px 與 320px；標籤自動換行、無橫向溢出。
- 確認標題灰線、灰色文字、灰底按鈕、膠囊尺寸與順序。
- 確認原本全部互動仍可用、placeholder 沒變成實際資料。
- 執行目標專案既有格式、型別、測試及 build 指令，回報實際結果。
- 本交接包沒有在目標 Next.js 版本實際建置；不要把交接包的靜態檢查描述成正式專案整合完成。
