# Chainseabase 開發文件

現行部署入口：[Windows 原生規格與 WIN 任務](windows-native-deployment.md)。核心功能沿用既有實作；部署與受邀讀取改造尚待驗收。

文件基準日：2026-10-23（Asia/Taipei）。版本：1.0。

狀態：使用者已確認架構與主要互動規則；本套文件將確認內容轉為可實作、可驗收的規格。**文件完成不代表程式、雲端服務或第三方整合已完成。**

另提供 [根目錄八類文件入口](../README.md)、[Claude 工作規則](../CLAUDE.md) 與 [可追蹤任務清單](../tasks.md)。根目錄摘要連結到本目錄的詳細規格，不另建立不同版本的需求。

從 GitHub 交接給 Claude Code 時，使用 [開發啟動指令](../START-DEVELOPMENT.md)，所有路徑均以儲存庫根目錄為基準。

## 閱讀順序

| 文件 | 使用方式 |
| --- | --- |
| [01 產品需求與權限](01-product-requirements.md) | 確認功能、角色、產品範圍與公開資料界線。 |
| [02 系統架構與資料模型](02-architecture-and-data.md) | 建立模組、資料表、隔離與索引。 |
| [03 核心互動與一致性規則](03-interaction-rules.md) | 實作 Schedule 指令、單維度 Roadmap 與私人 Personal。 |
| [04 API 契約](04-api-contracts.md) | 對接前後端，統一驗證、錯誤與併發語意。 |
| [05 Design System 與畫面規格](05-design-system.md) | 依 taste skill 方向實作元件、畫面與完整狀態。 |
| [06 Google Calendar 與雲端部署](06-calendar-and-deployment.md) | 配置 OAuth、日曆讀寫、寄信、資料庫與雲端交付。 |
| [07 交付階段與驗收案例](07-delivery-and-acceptance.md) | 排定實作順序、建立自動化測試與人工驗收。 |
| [08 決策紀錄](08-decisions.md) | 查閱已確認決策、被取代的舊規則及工程預設。 |

## 規格效力

1. 已確認的產品需求為基準；使用者後續明確修訂優先。
2. 本版 Roadmap 已取代最初 AND／OR、多維度拖曳及人工欄位歸屬方案。
3. 本版 Personal 取消欄位篩選，仍保留依 Person tag 的負責人切換。
4. 本版 Product 已加入 Google Calendar 讀寫，取代最初僅命名與切換的空白 Dashboard。
5. 標記「新功能」依原始需求的標示保留，不代表已調查 Featurebase 現行版本的功能差異。
6. 未指定的欄位長度、邀請有效期、分頁大小等列為**工程預設**，用於形成可執行契約，不冒稱逐項由使用者指定；調整時同步修改驗收與 API。

## 交付界線

本次只新增開發文件及設計方向來源資料。不建立資料庫、不寄送邀請、不註冊 Google 應用、不建立雲端帳號、不連結真實日曆、不執行部署。

正式實作需另行配置雲端專案、網域與憑證；見 [部署前置條件](06-calendar-and-deployment.md#部署前置條件)。這些前置條件不妨礙目前的文件交付。

## 參考來源與驗證狀態

- 產品參考：[Featurebase](https://www.featurebase.app/)。以使用者提供的需求為功能依據；尚未對登入後介面進行逐頁比對。
- 設計來源：[taste skill](https://github.com/leonxlnx/taste-skill)，固定 commit `6010f91a9935f1c167dfc500fb1a475681892e6b`，使用 `design-taste-frontend` 的 app-screen 流程。
- 已執行設計方向產生，選擇 `achromatic-ledger`，seed `20261023`；[原始方向資料](design/taste-direction.json)。
- 本輪官方網站 HTTP 查閱曾遭環境代理 403；不將文件中的第三方能力規劃視為當前帳號、方案或 OAuth 審核狀態的驗證。
- 應用已實作並有自動化測試；Calendar API 實機讀寫、Google 登入、寄信與部署驗收仍待外部設定，見 [驗收追蹤報告](acceptance-report.md)。
