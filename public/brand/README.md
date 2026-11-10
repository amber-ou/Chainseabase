# Chainsea 品牌素材交接

2026-11-04：使用者提供 `chainsea LOGO.7z`，其中原始檔為 `chainsea LOGO.png`。

- 網站資源路徑：`/brand/chainsea-logo.png`
- 專案檔案：`public/brand/chainsea-logo.png`
- 格式：PNG，1800 × 1800，RGBA，含透明與半透明像素。
- 圖片角落完全透明；聊天預覽的黑色不是實際底色，不需去背。
- 非透明像素範圍（左、上、右、下，右下不含）：`(352, 345, 1452, 1453)`，四周有透明留白。
- SHA-256：`b97e0bb7e0f5fcac47804e2bfda38efd1a062643f3d3c7501cf25b3fa9407ba7`

PNG 與壓縮檔內原始檔逐位元組相同，僅變更檔名；沒有重畫、縮放、裁切、去背或重新編碼。

## CC 接續 UI-05

素材已齊備。請依 `docs/change-requests/sidebar-position.md` 完成 `src/components/brand.tsx` 的 BrandMark 替換，套用至既有 Login、邀請頁、後台側邊欄及前台頁首，保留 Chainseabase 文字與既有版面。

使用專案資源路徑，不引用 Windows 本機絕對路徑。保留顏色、透明度與比例，並注意透明留白會縮小可見標誌；先檢查實際呈現，再調整顯示容器，不覆寫或裁切原始素材。

本次提交只交付原始素材與說明，未修改 BrandMark 或宣稱 Logo 已替換完成。由 CC 完成畫面、尺寸與載入驗證後，再更新 UI-05 狀態及 PR 說明；不合併 PR、不部署。
