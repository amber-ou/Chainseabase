# Claude Code 開發啟動指令

儲存庫：<https://github.com/amber-ou/Chainseabase>

文件位於 `main` 分支。下列路徑全部相對於儲存庫根目錄，不是 `docs/` 目錄，也不需要下載 ZIP。

## 取得專案

若本機尚未有 checkout，在預定放置專案的目錄執行：

```bash
git clone https://github.com/amber-ou/Chainseabase.git
cd Chainseabase
claude
```

若儲存庫為私有，使用有此儲存庫權限的 GitHub 身分與既有 Git 認證登入，不將 token 寫入指令。已有 checkout 時先檢查分支與未提交變更，再取得最新 `origin/main`；不要覆寫本地工作。

## 貼給 Claude Code 的指令

```text
請開發 GitHub 儲存庫 amber-ou/Chainseabase。
儲存庫網址：https://github.com/amber-ou/Chainseabase
已確認的開發文件在 main 分支，位於本 checkout 的根目錄與 docs/。

本次任務是實際寫出可執行、可測試的應用程式，不是重新規劃或只寫文件。
先確認目前 checkout 的 origin 與檔案位置，查看 Git 狀態並保留既有修改。
若 main 有更新，先安全取得最新文件，不要 reset 或覆寫既有工作。

一、讀取文件

根目錄的工作與需求入口：
- CLAUDE.md：專案工作規則。
- PRD.md：產品目標與第一版範圍。
- tasks.md：任務 ID、依賴、進度與外部條件。
- specs/README.md：功能與驗收對照。

詳細規格：
- docs/08-decisions.md：最新已確認決策與被取代的規則。
- docs/01-product-requirements.md：功能、角色與公開範圍。
- docs/02-architecture-and-data.md：架構、資料模型與一致性。
- docs/03-interaction-rules.md：Schedule、Roadmap、Personal 規則。
- docs/04-api-contracts.md：API、錯誤、併發與冪等契約。
- docs/05-design-system.md：taste skill 設計與完整介面狀態。
- docs/design/taste-direction.json：設計方向來源資料。
- docs/06-calendar-and-deployment.md：Google Calendar 與雲端部署。
- docs/07-delivery-and-acceptance.md：99 項待執行驗收案例。

補充入口在根目錄 data-permissions.md、ui-ux.md、architecture.md、operations.md。
根目錄摘要與 docs 詳細規格是同一份設計的閱讀入口，不是兩套需求。

二、開始實作並持續完成

從 tasks.md 的第一個未完成且依賴已滿足的任務開始。
若仍是只有文件的初始專案，從 M1-01 開始。
若已有程式，先驗證實際進度，不重建或覆寫已完成的實作。

先建立 Next.js／TypeScript、固定相依與 lockfile、可重跑 migrations／seed、
開發／build／typecheck／單元／整合／E2E 腳本及不含秘密的 .env.example。
把實際成功執行的啟動與測試指令補入 README.md 和 CLAUDE.md。

依 M1 至 M7 實作功能，並完成 M8 中可執行的 CI、部署設定、工作程序與維運準備。
每個任務完成後驗證、更新 tasks.md，再繼續下一個可執行任務。
不要每個階段都停下來要求我回覆「繼續」，也不要重問已確認的產品決策。

三、核心規則不得倒退

- 單一公司、多產品；前後台為獨立網站入口，共用後端與資料庫。
- Google 登入、受邀產品資格、Calendar scopes 與日曆 ACL 分別驗證。
- Roadmap 每張固定單一維度：狀態、類別或一個單選 Tag 群組。
- 每筆 Feedback 在每張 Roadmap 恰好一欄，拖曳只改該維度，沒有 AND／OR。
- 版本欄位與版本 Tag 共用來源。
- Personal 保留負責人切換、私人自由欄位、自動儲存，不修改共用分類。
- Schedule 指令、留言、格子與歷史保持交易一致，重試不重複。
- 移除清空操作歷史，不恢復被清空內容。
- 公開前台不得取得內部 Schedule、Person tag、私人 Tag 或憑證。
- Calendar 使用每人的授權，可在平台新增／編輯／刪除，支援本次／整系列，
  正確處理 ETag、重複活動與不確定的外部寫入結果。

四、介面與測試

依設計文件實作繁體中文介面，預設顯示時區 Asia/Taipei。
實作 loading、empty、error、permission-denied、saving、conflict 等完整狀態。
驗證 1440／768／390px、鍵盤操作、focus 與拖曳替代。
依驗收案例建立適當測試，重點驗證權限隔離、跨產品引用、多人併發、唯一分欄、
Personal 私密性、Schedule 移除規則，以及日曆失敗／重試。
修復問題，不刪除斷言、降低需求或以假成功與靜態 mock 代替正式功能。

五、外部條件

先檢查已有環境設定，只確認名稱與狀態，不印出秘密。
缺少 Google／Supabase／Resend 等設定時，列出變數名稱、配置位置與影響功能，
不要要求在聊天貼上秘密，也不要把值放進 Git。

缺少外部設定時持續完成不受影響的工作，建立真實 adapter 與隔離測試。
清楚區分 mock、sandbox 與真實整合，未實測的功能不能標記為完成。
正式部署、真實寄信與正式日曆寫入，依當次明確授權執行。

六、進度與交付

適時回報已完成項目與實際阻擋，並將任務 ID、檢查結果及下一步寫入 tasks.md，
以便長任務或後續 session 接續，不重做已完成工作。

完成時提供：
1. 已完成的功能與任務 ID。
2. 安裝、啟動、測試的確切命令與工作目錄。
3. 實際測試數與 passed／failed／skipped／unrun。
4. 尚缺的外部設定、具體設定步驟與已知限制。
5. 雲端部署準備狀態，不把文件完成當成應用已發布。

現在開始讀取此 checkout 的文件，檢查現況，並執行第一個可開始的開發任務。
```

這份文件是後續開發的啟動提示，不表示應用程式已實作或雲端服務已配置。
