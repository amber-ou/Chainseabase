# 驗收報告

更新日期：2026-10-28。現行驗收規格見 [驗收案例](07-delivery-and-acceptance.md) 與 [WIN 任務](windows-native-deployment.md#開發任務與驗收)。原雲端／匿名前台驗收及 147 單元整合等當時紀錄完整保留在 [歷史報告](history/acceptance-report.md)；不當作本次重跑結果。

## Windows 實機：使用者回報

本表來自本次對話中的輸出與使用者確認；代理沒有直接連入 Windows。驗證日期記錄日為 2026-10-28，跨日操作不推測精確執行時間。

| 項目 | 證據 | 範圍 |
| --- | --- | --- |
| 平台 | Windows 11 Pro 10.0.26200、Core Ultra 7 258V、32 GB RAM | 主機資訊回報 |
| 相依安裝 | Node 24.11.1；系統 npm 11.6.4；依指令以 npm 10.9.4 執行 ci，退出碼 0 | 不等於完整依賴相容性測試 |
| PostgreSQL | psql 回報 18.6、唯讀查詢成功 | 本機資料庫，不是 Supabase |
| Migration | Applied: 0001_init.sql, 0002_roadmap_placement_revision.sql；退出碼 0 | 本機 development |
| 初始化／重跑 | 使用者回報 migration 重跑及 bootstrap 兩次均成功 | 預設產品與首位資格；不重設既有資料 |
| Build | 使用者貼出 Next.js 結尾與退出碼 0 | Windows 正式建置流程 |
| 網站啟動 | 本機登入畫面截圖 | localhost／127.0.0.1，APP_ENV=development |
| Google 登入 | 使用者確認成功進入後台 | 真實本機登入；日曆與前台登入未據此驗證 |

連線字串嘗試曾出現密碼驗證失敗。最後成功組合是無密碼的本機 URL＋PGPASSWORD；只能記為設定差異排除成功，沒有證據證明驅動程式 URL 解碼有缺陷。秘密不存入本報告。

## 尚未驗證

- Windows 原生完整 lint／typecheck／單元／整合／E2E、PostgreSQL 18 完整回歸與 30 人負載。
- WIN-02 正式 filesystem、WIN-04 受邀資料讀取（包括新版 A02、F09）；舊匿名測試不適用。
- 設定持久化、NTFS ACL、Windows 服務、無桌面登入重開機恢復、排程與磁碟告警。
- 備份／還原、外部 Tunnel、正式 HTTPS callbacks、Google Calendar 真實讀寫、寄信與長期授權。
- 舊報告中尚未完成的螢幕閱讀器／瀏覽器相容性／人工驗收，仍維持未完成。

## 舊資源

使用者曾回報 Supabase staging migrations／bootstrap／重跑成功及 Vercel Git 斷線。舊資源不等於 Windows 正式環境；保留至遷移驗收完成，不自動刪除。
