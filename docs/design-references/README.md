# 設計參考附件

使用者提供的樣式參考，只用於版面與互動參考，不是正式元件；與各階段清單衝突時，以清單為準。各組附件有同名檔案，所以分開存放，避免混用。為避免被 TypeScript 編譯與 lint 收入，`.tsx` 檔以 `.tsx.txt` 保存。

| 目錄 | 用途 | 對應清單 |
| --- | --- | --- |
| `phase2-feedback-dialog/` | 新增 Feedback 彈窗（STYLE_SPEC.md、AI_HANDOFF.md、FeedbackDialogStyle.tsx、feedback-dialog.css） | 第二階段 FB01–FB09 |
| `phase3-roadmap/` | Roadmap 看板（STYLE_SPEC.md、AI_HANDOFF.md、RoadmapStyle.tsx、roadmap.css） | 第三階段 III-R01–III-R08 |
| `feedback-detail/` | 已建立 Feedback 的詳情與留言（AI_HANDOFF.md、STYLE_SPEC.md、README.zh-TW.md、MANIFEST.json、App.tsx、index.css；2026-11-10） | 追加調整 DETAIL／COMMENT／SCROLL |
| `feedback-list/` | 後台 Feedback 分組表格（AI_HANDOFF.md、STYLE_SPEC.md、FeedbackListStyle.tsx、feedback-List.css；2026-11-10，注意檔名大小寫） | LIST-01–LIST-15 |

採用、對應至 tokens 及不採用的部分，記錄在 [變更需求](../change-requests/sidebar-position.md)。
