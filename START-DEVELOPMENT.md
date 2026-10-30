# Claude Code：Windows 原生改造指令

儲存庫：<https://github.com/amber-ou/Chainseabase>。文件分支：`docs/windows-native`；實作基準：`claude/keen-lamport-4qb974` 的 `82b7641`。main 仍有較早文件，不是本輪工作基準。不得重建已實作的產品。

## 安全取得文件

已有 checkout：先查看 `git status --short`、確認 origin，保留使用者的本機變更與 secrets，再執行 `git fetch origin`。工作樹乾淨且沒有同名本地分支時，可用 `git switch --track origin/docs/windows-native`；若已存在則切換現有分支並檢查差異。不要 reset／clean，也不要為了切分支刪 `.env.local` 或資料。

尚未 clone 時：

```powershell
git clone --branch docs/windows-native https://github.com/amber-ou/Chainseabase.git
Set-Location Chainseabase
```

## 貼給 Claude Code

```text
請在 amber-ou/Chainseabase 既有實作上完成 Windows 原生部署改造。
先讀本 checkout 的 CLAUDE.md、docs/windows-native-deployment.md、tasks.md、
operations.md、data-permissions.md、docs/04-api-contracts.md、
docs/07-delivery-and-acceptance.md 與 docs/acceptance-report.md。
文件位於 docs/windows-native 分支；不要改從 main 重建 M1–M7。
檢查工作樹並保留使用者變更，以該文件分支為基礎建立實作分支。

已確認：Windows 原生 Node.js＋PostgreSQL，不採 WSL／Docker／Vercel 部署。
使用者已在 Node 24.11.1、PostgreSQL 18.6 完成安裝、migration、bootstrap、
build、網站啟動及 Google 登入；這是實機回報，不代表完整測試通過。
先完成 WIN-01 安全設定持久化與 PowerShell 操作，再處理 WIN-02 正式本機
頭像、WIN-03 Windows 服務、WIN-04 僅受邀讀取，再依依賴完成 WIN-05～07。
保留核心 Feedback／Schedule／Roadmap／Personal／Calendar 規則。
不得把開發 fake 視為正式儲存、開啟測試登入繞過權限，或新增第一版以外的附件功能。

CLI、網站及排程要用一致的秘密載入規則；不能依賴開著 PowerShell 的環境變數。
正式服務須不登入桌面就能開機恢復；DB 不開放外網；備份涵蓋 DB、頭像及金鑰還原。
維持既有角色與產品資格；/public/ API 不再代表匿名可讀。
不要只改登入頁而漏掉 API、直接網址、頭像、快取與撤銷權限測試。

新增驗收要有實際平台、命令、退出碼及 mock／真實區分。
若你只有 Linux／雲端環境，可實作並跑適用測試，但 Windows 服務與 NTFS 等
必須交付明確 PowerShell 驗證步驟並標未執行；不得聲稱 Windows 實測完成。
不刪現有開發庫或 Supabase staging、不合併 PR、不部署對外站點、不寄真實邀請
或修改真實日曆，除非使用者在該步已有明確授權。
完成可做的實作、測試與文件後建立待審查 PR，說明剩餘外部條件。
```
