# Chainseabase 專案工作規則

適用於 Claude 在此專案的後續工作。使用者最新明確指示與當前工具／平台規則優先；本文件不授予額外外部服務權限。

## 先了解現況

目前是文件專案，尚無應用程式、package.json、lockfile、migration 或測試 runner。不要宣稱功能可執行，也不要為了跑不存在的指令任意建立假測試。只有在使用者要求進行開發後，才從任務清單開始實作。

約 30 人使用的單公司多產品平台，Google 登入、前後台分站、Feedback／Schedule／Roadmap／Personal、站內通知，以及 Google Calendar 讀寫。已選 Next.js／TypeScript、Vercel、Supabase、Resend。

## 必讀文件

1. [PRD.md](PRD.md)：目的與範圍。
2. [docs/08-decisions.md](docs/08-decisions.md)：最終決策與工程預設。
3. [specs/README.md](specs/README.md)：依功能找到詳細規格與驗收。
4. [architecture.md](architecture.md)、[data-permissions.md](data-permissions.md)、[ui-ux.md](ui-ux.md)：設計入口。
5. [docs/04-api-contracts.md](docs/04-api-contracts.md)：API 契約。
6. [tasks.md](tasks.md)、[operations.md](operations.md)：進度與營運。

根目錄文件是摘要與入口；`docs/` 保存詳細規格。不要在兩個位置各維護一套不同規則。

## 工作方式

- 先查看工作目錄、Git 狀態與現有使用者變更，保留非本任務修改。雲端任務通常已有隔離 checkout，除非使用者要求，不另建 worktree。
- 依任務 ID 小步完成，開工前確認依賴；完成後更新 tasks 狀態與證據。
- 先讀既有 manifests／lockfiles／版本設定，再使用實際存在的腳本；固定相依版本，不任意切換包管理器或框架。
- 核心邏輯留在服務層；TypeScript 型別不能取代 runtime 驗證、權限與 DB 約束。
- API 明確列出允許欄位；禁止任意 mass assignment。使用參數化查詢，避免記錄 token 或私人正文。
- UI 依 Design System；以使用者內容與真實狀態呈現，不用假成功、假數據或永久 mock 代替完成。
- 只有文件修改時做文件檢查；業務邏輯修改則執行相關測試。失敗需診斷，不刪斷言或把案例改成永遠通過。
- 回報變更、實際執行檢查與剩餘限制；區分 mock／sandbox／正式，以及 passed／failed／skipped／unrun。

## 不可倒退的規則

- Roadmap 單維度、Tag 限 single 群組、同張看板每筆恰一欄；沒有 AND／OR 或人工卡片歸屬。
- 版本欄位與版本 Tag 共用來源；拖曳只改指定維度。
- Personal 保留負責人切換、私人自由欄位、自動儲存，不改共用資料。
- Schedule 表頭算第 1 列，不能操作表頭；移除 clear 歷史不復原內容。
- 內部角色、產品資格與私人 owner 必須後端驗證；管理員不因此能讀別人的私人 Tag／token。
- Google 登入、受邀資格、Calendar scopes 與 Google 日曆 ACL 是不同的檢查。

## 開發與測試指令

目前可以從儲存庫根目錄執行：

```bash
git status --short
git diff --check
```

第二個指令只涵蓋 Git diff 的格式，不能取代未追蹤文件、連結、業務規則或功能測試。若只有解壓縮文件而沒有 Git 儲存庫，這兩個指令不適用。

| 用途 | 現況 |
| --- | --- |
| 安裝相依 | 尚未定義；建立 manifest 與 lockfile 後補上已執行成功的 frozen install 指令。 |
| 啟動開發 | 尚未定義；M1-01 補上實際腳本與工作目錄。 |
| lint／typecheck／build | 尚未定義；M1-01 建立並驗證。 |
| 單元／整合／E2E 測試 | 尚未定義；M1-01／M1-02 建立 runner 與隔離測試資料。 |
| DB migration／seed | 尚未定義；M1-02 建立、重跑驗證並記錄。 |
| 部署／復原 | 依真實雲端配置補上，不假造已驗證命令。 |

第一個實作任務必須把此表與 README 更新成精確、可重現的指令。

## 需求衝突與外部操作

使用者最新已確認決策優先於較舊的對話草案；本版決策紀錄已明確標示被取代規則。對一般工程選擇依文件預設執行，不重問已回答事項。若發現真正改變公開範圍、資料結果或已確認需求的矛盾，指出具體兩條規則與影響，在等待回答時繼續不依賴該決策的工作。

文件本身不代表已授權發布正式站點、寄送真實邀請或修改公司日曆。依當次使用者授權範圍執行；本地與 sandbox 的可逆工作不需要重複確認。秘密透過環境設定提供，勿要求在聊天貼上。
