# 功能規格入口

詳細規格已分布於 `docs/`，本目錄集中提供功能、規則與驗收對照，不複製正文。修改功能時同步更新對應詳細文件、API 與驗收，避免產生兩套版本。

| 功能 | 詳細行為 | API | 驗收案例 |
| --- | --- | --- | --- |
| 登入、邀請、角色、產品 | [產品需求](../docs/01-product-requirements.md) | [API 契約](../docs/04-api-contracts.md) | A01–A12 |
| Feedback Modal、連續新增、搜尋與版本 | [產品需求](../docs/01-product-requirements.md) | [API 契約](../docs/04-api-contracts.md) | F01–F05、F14–F15 |
| 標籤與 Person tag 設定 | [產品需求](../docs/01-product-requirements.md) | [API 契約](../docs/04-api-contracts.md) | F03–F07 |
| 前台、公開／內部、留言與投票 | [產品需求](../docs/01-product-requirements.md) | [API 契約](../docs/04-api-contracts.md) | F08–F13、R14 |
| Schedule | [指令、交易與歷史](../docs/03-interaction-rules.md) | [API 契約](../docs/04-api-contracts.md) | S01–S17 |
| Roadmap 與版本規畫 | [唯一分欄、拖曳與排序](../docs/03-interaction-rules.md) | [API 契約](../docs/04-api-contracts.md) | R01–R14 |
| Personal | [責任範圍與私人整理](../docs/03-interaction-rules.md) | [API 契約](../docs/04-api-contracts.md) | P01–P08 |
| Notification | [產品需求](../docs/01-product-requirements.md)、[事件規則](../docs/03-interaction-rules.md) | [API 契約](../docs/04-api-contracts.md) | N01–N06 |
| Google Calendar | [日曆規格](../docs/06-calendar-and-deployment.md) | [API 契約](../docs/04-api-contracts.md) | C01–C18 |
| UI／UX、響應式與可及性 | [Design System](../docs/05-design-system.md) | — | V01–V04 |
| 雲端與維運 | [部署與維運](../docs/06-calendar-and-deployment.md) | [API 慣例](../docs/04-api-contracts.md) | O01–O05 |

案例的操作與預期結果統一在 [交付與驗收](../docs/07-delivery-and-acceptance.md)。目前全部為待執行案例。

## 實作前要守住的規則

- Roadmap 只依狀態、類別或單一單選 Tag 群組分欄，不重新加入 AND／OR。
- 版本顯示與版本 Tag 共用來源；拖曳只修改選定維度。
- Personal 保留負責人切換，但私人欄位沒有條件篩選；操作自動儲存。
- Schedule 的歷史移除不等於全面 undo，清空過的內容不復活。
- 匿名可瀏覽公開前台不代表可互動；Google 登入也不等於受邀或有 Calendar 權限。

已確認與被取代的規則見 [決策紀錄](../docs/08-decisions.md)。
