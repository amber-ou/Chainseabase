# Chainseabase

公司內部使用的多產品需求與回饋管理平台，目標約 30 位使用者。提供獨立公開前台、團隊後台、Feedback、Roadmap、Personal、Schedule 與 Google 共用日曆讀寫。

目前為**開發文件階段**，尚未實作應用程式、安裝應用依賴或部署服務。

交給 Claude Code 開發時，先閱讀根目錄的 [START-DEVELOPMENT.md](START-DEVELOPMENT.md)，其中包含 GitHub 位置、文件路徑與可直接貼上的開發指令。

## 開發文件

從 [文件索引與閱讀順序](docs/README.md) 開始。

### 八類文件入口

| 文件 | 用途 |
| --- | --- |
| [PRD.md](PRD.md) | 產品目的、使用情境與第一版範圍。 |
| [specs/](specs/README.md) | 功能規格與驗收對照。 |
| [data-permissions.md](data-permissions.md) | 資料關係、角色與產品／私人隔離。 |
| [ui-ux.md](ui-ux.md) | 畫面、設計方向與互動狀態。 |
| [architecture.md](architecture.md) | 技術架構、API 與一致性入口。 |
| [CLAUDE.md](CLAUDE.md) | Claude 專案工作規則。 |
| [tasks.md](tasks.md) | 具依賴關係與狀態的開發任務。 |
| [operations.md](operations.md) | 部署、維運與上線檢核。 |

根目錄是摘要與工作入口；以下 `docs/` 保留詳細規格，避免複製出兩套互動定義。解壓縮文件包後從本檔開始閱讀，Markdown 架構圖需使用支援 Mermaid 的閱讀器顯示。

### 詳細規格

- [產品需求與權限](docs/01-product-requirements.md)
- [系統架構與資料模型](docs/02-architecture-and-data.md)
- [核心互動與一致性規則](docs/03-interaction-rules.md)
- [API 契約](docs/04-api-contracts.md)
- [Design System 與畫面規格](docs/05-design-system.md)
- [Google Calendar 與雲端部署](docs/06-calendar-and-deployment.md)
- [交付階段與驗收案例](docs/07-delivery-and-acceptance.md)
- [決策紀錄與範圍界線](docs/08-decisions.md)

文件以繁體中文撰寫；介面預設時區為 `Asia/Taipei`，一般時間戳儲存為 UTC。正式程式碼的啟動、測試與部署指令將隨實作補上，不以尚未存在的指令宣稱可執行。
