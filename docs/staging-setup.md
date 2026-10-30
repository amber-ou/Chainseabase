# Staging 建置入口

目前選擇 Windows 原生部署，不繼續部署 Vercel。操作順序見 [維運文件](../operations.md)，詳細設計見 [Windows 原生規格](windows-native-deployment.md)。

Windows staging 須與 development／production 分開資料庫、頭像、服務、埠與秘密；保留嚴格模式，正式 filesystem 支援完成前不得把 fake 偽裝成 staging 成功。

使用者已回報舊 Supabase staging migration／bootstrap 及重跑成功；Vercel 專案已建立、Git 連線已斷開。先保留，不刪資料、不重新初始化取代現有資料。舊 [雲端建置清單](history/staging-setup.md) 僅作歷史參考。
