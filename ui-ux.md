# UI／UX 規格入口

完整頁面、Design Tokens、元件與互動狀態見 [Design System 與畫面規格](docs/05-design-system.md)。核心資料操作流程見 [互動規則](docs/03-interaction-rules.md)。

## 畫面架構

後台依序為 Product、Feedback、Roadmap、Personal、Live Portal、User、Notification、Setting。Product 為首頁，呈現產品管理與日曆；Notification 為浮層，Live Portal 導向另一個前台網站。

前台使用簡潔產品導覽，僅 Feedback／公開 Roadmap 與登入／互動入口，不呈現後台導航與內部資料。

Feedback 建立及查看以 Modal 完成，提供內容與 Schedule Tab，沒有 Insight。Schedule 固定 PO／UIUX／前端／後端／QA 五欄，下方是新增列、留言與操作歷史。Personal 才顯示個人 Tag 第三排。

## 設計方向與檔案狀態

- 使用指定 taste skill 的應用程式介面流程，方向為 Achromatic ledger，seed 20261023。
- 灰白框架、近黑主要操作；Roadmap 藍色識別、Personal 青綠識別；成功命令使用成功色加文字／圖示。
- 字型、尺寸、邊框、間距、對比與響應式詳見正式 Design System；原始方向資料在 [taste-direction.json](docs/design/taste-direction.json)。
- 目前沒有 Figma 檔案或連結；之後若提供 Figma，再在此登錄真實連結，不製造假連結。
- 畫面已實作於 `src/features/`，設計 token 在 `src/app/globals.css`。已執行 Playwright 1440／768／390 檢查與 taste skill lint／inspector（公開頁），結果見 [驗收追蹤報告](docs/acceptance-report.md) 與其歷史快照中的 V01–V04。

## 一致互動

| 情境 | 規則 |
| --- | --- |
| 表單提交 | 明確送出；驗證失敗保留輸入，不假顯示成功。 |
| Personal 整理 | 自動儲存、顯示儲存狀態；失敗回復並可重試。 |
| Schedule 草稿 | 已套用至草稿，不提前顯示已正式儲存。 |
| 衝突 | 保留草稿並載入最新資料，不靜默覆寫別人的修改。 |
| 刪除／歷史移除 | 顯示具體後果與確認 Modal。 |
| 拖曳 | 可見落點、待儲存與回復；有鍵盤／選單替代。 |
| 載入／空白／錯誤／無權限 | 分開呈現，不把無權限或讀取失敗畫成沒有資料。 |

驗證尺寸為 1440／768／390px；手機折疊 sidebar，Schedule／看板在自身容器水平捲動，手機日曆預設活動清單。元件需有焦點、鍵盤與輔助技術語意。

驗收：[V01–V04](docs/07-delivery-and-acceptance.md)。
