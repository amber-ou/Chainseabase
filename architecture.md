# 技術設計入口

完整系統圖、ER 圖、資料表、模組與索引見 [系統架構與資料模型](docs/02-architecture-and-data.md)。API 的 request／response、錯誤碼與併發慣例見 [API 契約](docs/04-api-contracts.md)。

## 已選架構

| 層級 | 選擇 |
| --- | --- |
| 前端／後端 | 同一 Next.js＋TypeScript 模組化單體，兩個網站 host，共用服務層。 |
| 資料庫 | Supabase PostgreSQL；正式 migration／索引待實作。 |
| 身分 | Google OAuth／OIDC，伺服器管理 session，Email 邀請另決定產品互動權。 |
| 個人日曆授權 | 與登入分開，各使用者 token 後端加密保存。 |
| 儲存 | Supabase Storage 用於頭像；第一版不實作 Feedback 附件。 |
| 寄信／工作 | Resend 邀請信；DB outbox＋可恢復的受保護工作程序。 |
| 雲端 | GitHub 保存程式與觸發 CI；Vercel 執行網站及 API。 |

GitHub Pages 不能單獨承載登入、權限、日曆憑證及資料寫入。兩個網站共用資料庫，不為前台再複製一份 Feedback。

## 一致性與多人協作

- 共用分類變更透過同一領域服務，避免 Modal、Roadmap、Tag API 行為分歧。
- 本地寫入使用交易、外鍵、revision 與冪等 key；衝突不能靜默覆寫。
- Schedule 的留言、表格、歷史與事件同交易提交；清空的內容不因移除歷史復活。
- Roadmap rank 只決定排序，不能讓卡片留在與資料值不符的欄位。
- Personal 位置不回寫 Feedback；私有 cache 與查詢以 owner 隔離。
- Google／Resend 與本地 DB 無共同交易，以 mutation 狀態、outbox 與核對重試處理，不宣稱可一起 rollback。

## 尚未建立的部分

目前沒有應用程式、相依清單、lockfile、SQL migration、可執行測試或雲端部署。框架、auth library、DB client 具體版本由第一個實作任務選定受支援版本並鎖版，不能把文件中的目標結構當成已存在實作。

實作順序見 [tasks.md](tasks.md)，部署前置與日曆細節見 [operations.md](operations.md) 及 [Calendar 與雲端部署](docs/06-calendar-and-deployment.md)。
