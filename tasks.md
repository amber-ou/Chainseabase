# 開發計畫與進度

更新日期：2026-10-28。以既有實作 `82b7641` 為基礎；不重做 M1–M7。舊任務與測試證據見 [歷史任務紀錄](docs/history/tasks.md)，本輪依 [Windows 原生規格](docs/windows-native-deployment.md) 改造。

## 目前狀態

使用者回報 Windows 11 Pro、Node 24.11.1、PostgreSQL 18.6：套件安裝、migrations 0001／0002、bootstrap 與重跑、build 退出碼 0、本機網站及 Google 真實登入成功。尚未由代理在該 Windows 主機重跑完整檢查，不能標示完整相容性通過。

| ID | 交付 | 依賴 | 狀態 |
| --- | --- | --- | --- |
| DOC-WIN | 現行需求、權限、架構、維運、驗收與 Claude 指令一致化 | 使用者確認原生部署 | 完成（文件）；不代表功能實作完成 |
| WIN-01 | PowerShell 設定持久化／安全載入、版本與安裝文件、Windows 建置和隔離測試 | 現有實作 | 進行中：載入器、PowerShell 工具、文件與 CI（Windows Server 執行器、Node 24＋PostgreSQL 18）已實作；使用者 Windows 11 主機依 [Windows 設定與安裝](docs/windows-setup.md) 實測待回報 |
| WIN-02 | 正式 filesystem 頭像、provider 設定及路徑防護 | WIN-01 設定契約 | 待開始 |
| WIN-03 | Windows 網站／資料庫服務、重開機恢復、權限與日誌 | WIN-01、WIN-02 | 待開始 |
| WIN-04 | 全面受邀資料讀取與角色／產品界線 | 既有身分實作 | 待開始；可與 WIN-02 並行 |
| WIN-05 | 排程、獨立備份、隔離還原與告警 | WIN-02、WIN-03、備份裝置 | 待開始 |
| WIN-06 | Tunnel、正式 host、Google／寄信／sandbox 日曆 | WIN-02～05、網域與公司政策 | 待開始 |
| WIN-07 | 30 人負載、斷網／重開機／回退與發布 | WIN-01～06 | 待開始 |

## 外部條件

- Windows 服務管理權限、主機電源／休眠／更新維護時段仍須驗證。
- 獨立備份裝置尚未提供；域名、Tunnel 政策、寄件網域及 sandbox 日曆待設定。
- Google 本機 OAuth 已成功，不能據此標示 Calendar API、正式 HTTPS callback 或長期 token 刷新成功。
- Supabase staging 及 Vercel 舊資源保留；本輪不合併既有 PR、不部署、不刪資料。

每個 WIN 任務須記錄 commit、命令、退出碼、執行平台、mock／真實服務與未執行項目。只有證據齊全才標完成；文件與安裝指南不得含密碼或 token。

## WIN-01 紀錄（2026-10-28）

```text
任務：WIN-01 設定持久化與安全載入
狀態：進行中（實作完成；使用者主機實測待回報）
平台：Linux 雲端容器（Node 22.22.0、PostgreSQL 16）；Windows 部分另由 CI 的 windows-2025 執行器執行，不是使用者的 Windows 11 主機
交付：scripts/config/load-config.mjs（單一載入器，網站以 node --import 預載、CLI 第一個 import）、scripts/config-check.ts（npm run config:check）、scripts/windows/*.ps1（前置檢查、建立／設定／驗證受 NTFS ACL 保護的設定檔）、docs/windows-setup.md、migration 目錄與 CRLF／LF 檢查碼相容、npm run dev／start 只監聽 127.0.0.1、測試環境隔離 APP_ENV／CHAINSEABASE_CONFIG_FILE
本機檢查（Linux）：lint 0、typecheck 0、npm test 0（16 檔 164 tests 全過）、build 0、security:scan 0、test:e2e 0（64 passed）；npm start 在繼承 APP_ENV=staging 時 exit 78 拒絕、乾淨 development 時 health 200 且只監聽 127.0.0.1
CI 新增：win-native（PowerShell 5.1／7 解析、前置檢查、npm ci／lint／typecheck／build、建立設定檔與 ACL 正反測試、URL 無密碼＋PGPASSWORD 的 migrate／bootstrap、衝突 exit 78、Windows 上 npm test）；pg18-node24（Linux 上 Node 24.11.1＋PostgreSQL 18 的 migration 與 npm test）；結果記於 PR
未完成：使用者主機的前置檢查、設定檔建立、config:check、migrate／build 回報；E2E 未在 Windows 執行；WIN-03 服務帳號讀取設定檔、WIN-05 排程讀取設定檔尚待驗證
```
