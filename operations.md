# 部署與維運入口

詳細雲端架構、環境變數、Calendar 授權、CI、備份與監控見 [Google Calendar 與雲端部署](docs/06-calendar-and-deployment.md)。本文件提供執行順序與檢核入口，不代表環境已建立。

## 環境分離

| 環境 | 用途 | 資料與第三方服務 |
| --- | --- | --- |
| 開發 | 本地／雲端開發與單元、整合測試。 | 隔離測試資料；第三方可先用 adapter fake。 |
| Staging | 固定網域的整合、OAuth、寄信、日曆與 E2E。 | 測試 DB、Google client／日曆與允許的測試收件人。 |
| Production | 公司正式使用。 | 正式 DB、正式授權與已驗證寄件網域；不得給任意 preview 共用。 |

程式由 GitHub CI 進入 Vercel；Supabase 保存資料與頭像，Resend 寄邀請。Google Calendar 是活動正式來源。GitHub Pages 不取代動態後端。

## 首次上線檢核

- [ ] 雲端專案、網域、HTTPS、區域與方案限制確認。
- [ ] 資料庫 migration、可重跑初始化與首位團隊 Email 驗證。
- [ ] Google 登入及 Calendar callback、scopes、正式 consent 條件驗證。
- [ ] 共用日曆分享與 writer／reader／無權限案例驗證。
- [ ] Resend 寄件網域與 Email 邀請流程驗證。
- [ ] secrets 只在安全設定中，前端 bundle／Git／log 不含秘密。
- [ ] worker/outbox 可恢復、通知去重、寄信失敗可重試。
- [ ] 備份還原演練、監控與回退方案完成。
- [ ] staging 驗收有實際結果，取得當次正式發布授權。

檢核項目尚未執行，不預先打勾。

## 變數與秘密

名稱清單與用途見 [環境與秘密變數](docs/06-calendar-and-deployment.md#環境與秘密變數)。記錄名稱與配置狀態即可，不在文件貼值。OAuth token、DB URL、Resend key、加密金鑰不得進入公開環境變數或前端程式。

## 遷移、備份與復原

資料遷移先在 staging 驗證；正式使用相容的 expand／contract，先確認備份再執行有資料風險的遷移。應用可回退不等於資料庫能安全 down migration，需依實際 schema 與備份計畫處理。

還原演練應在隔離環境進行，確認公開／私人資料與關聯完整；不以「有備份」代替「已驗證能還原」。備份頻率、保留期與可接受資料損失需在選定正式方案後記錄，不預設服務商免費方案已包含全部能力。

## 常見故障處理入口

| 現象 | 優先檢查 |
| --- | --- |
| Google 登入失敗 | callback URI、host allowlist、client、consent、state；不記錄憑證。 |
| Calendar 無法寫入 | 本人 scopes、Google ACL、token 刷新、ETag、bindingRevision；不借用別人 token。 |
| 日曆送出後逾時 | 檢查 mutation／穩定 event ID，再核對 Google；不要直接重建活動。 |
| 邀請未收到 | Resend 結果、寄件網域、outbox 租約／重試與收件人狀態。 |
| 通知延遲或重複 | 工作積壓、事件＋接收者唯一限制、重試與存取資格。 |
| 公開資料範圍錯誤 | 立即限制有問題的公開入口、失效快取，檢查 DTO 與權限，再修正與回歸。 |

每次事故保存 request ID、影響範圍、處理與復原時間、修正及回歸結果；不記錄完整私人正文或秘密。

目前無已驗證啟動／部署指令；由 [M1-01、M8 任務](tasks.md) 隨實作補齊。營運驗收見 [O01–O05](docs/07-delivery-and-acceptance.md)。
