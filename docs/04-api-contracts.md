# API 契約

本契約已實作於 `src/server/api/`（實作補充見文末）。基底 `/api/v1`；Google callback 路由同樣在此基底下，遵守相同權限與 host 限制。

## 通用格式

- JSON 使用 camelCase；本地識別碼為 UUID，Google event/calendar ID 保持 Google 原始字串並正確 URL encode。
- 權限來自 session 與資料庫，不接受 body 的 role、actorId、ownerId 作為授權依據。
- 內部端點只在後台 host 提供；前台 host 僅允許 auth、public、portal 端點。
- 路徑中的 productId 是範圍限制，不代表有權限。所有下層 ID 必須重新確認歸屬。
- 未授權的資源 ID 統一回 404，避免猜 ID 探測私人內容；未登入的受限端點回 401。
- 清單預設 `limit=50`、上限 100、opaque cursor；搜尋字串長度上限工程預設 200。
- `createdAt` 等一般時間戳為帶 offset 的 ISO 8601；Calendar 全天 startDate/endDate 為 YYYY-MM-DD，endDate exclusive。

成功回應：

```json
{
  "data": { "id": "<uuid>", "revision": 4 },
  "meta": { "requestId": "<request-id>" }
}
```

清單回應：

```json
{
  "data": [],
  "meta": { "nextCursor": null, "total": 0, "requestId": "<request-id>" }
}
```

錯誤回應：

```json
{
  "error": {
    "code": "REVISION_CONFLICT",
    "message": "內容已被更新，請重新載入後再操作。",
    "fieldErrors": {},
    "retryable": false,
    "requestId": "<request-id>"
  }
}
```

不要在錯誤正文洩漏 token、SQL、Google 憑證、其他產品資料或未授權的目前 revision。

| HTTP | 典型 code | 處理 |
| --- | --- | --- |
| 400 | INVALID_REQUEST | 結構／型別無效。 |
| 401 | AUTH_REQUIRED | 前往 Google 登入。 |
| 403 | ACTION_FORBIDDEN / CALENDAR_ACCESS_DENIED | 已知範圍內無操作權；保留表單。 |
| 404 | NOT_FOUND | 不存在、已刪除或無權取得該資源。 |
| 409 | REVISION_CONFLICT / IDEMPOTENCY_CONFLICT / REFERENCE_IN_USE | 重新讀取或先解決引用，不盲目重試。 |
| 422 | INVALID_COORDINATE / SINGLE_SELECT_CONFLICT / UNSUPPORTED_RECURRENCE | 顯示對應欄位或操作錯誤。 |
| 428 | REVISION_REQUIRED | 缺少契約要求的版本資訊。 |
| 429 | RATE_LIMITED | 依 Retry-After 退避。 |
| 502/503 | UPSTREAM_UNAVAILABLE | 可重試；不得先顯示成功。 |

## 併發與冪等

- 所有 mutation 接受 `Idempotency-Key`，建立 Feedback、Schedule 指令、拖曳、邀請及 Calendar 寫入為必填。
- key 的作用域是 session user＋端點操作＋產品。相同 key／相同 payload 回原結果；相同 key／不同 payload 回 409。
- 一般更新以 body `expectedRevision` 驗證；移除以 `If-Match: "<revision>"` 驗證。無權資源不得先回 revision 衝突。
- 同一個可重試網路操作沿用 key；使用者修改內容後是新操作、新 key。工程預設本地冪等結果保存至少 24 小時；外部 Calendar 未決 mutation 保存到完成核對。
- Product 設定用 product revision；Feedback 主資料用 feedback revision；Schedule 用 schedule revision；Roadmap 及 Personal 各用自身 revision。帳號、邀請、私人 Tag 與活動關聯用各實體 revision；整組私人 Tag 關係用 personal_feedback_metadata revision，首次建立為 0。
- 投票、按讚、已讀以 PUT 設成已存在、DELETE 設成不存在，不用易受重試影響的 toggle。

## Auth、User 與產品

| 方法／路徑 | 權限與行為 |
| --- | --- |
| GET `/auth/google/start` | 開始 Google 登入，returnTo 僅允許本站安全路徑。 |
| GET `/auth/google/callback` | 驗證 OAuth／OIDC，建立 session；不自動授予團隊角色。 |
| POST `/auth/logout` | 撤銷目前 session。 |
| GET `/me` | 本人公開個資、角色、可互動產品；不回 token。 |
| PATCH `/me` | 本人名稱等個資，expectedRevision。 |
| POST `/me/avatar-upload` | 簽發本人頭像上傳用途；限制 MIME、大小與 bucket path。 |
| GET `/products` | 團隊所有產品；前台可另外用 public products 查詢公開入口。 |
| POST `/products` | 團隊，name；初始化選項與預設看板，同交易。 |
| PATCH `/products/:p` | 團隊，name、expectedRevision。無封存／刪除端點。 |
| GET `/products/:p/users` | 團隊；所有有效團隊及該產品受邀測試成員。 |
| GET `/products/:p/users/:u` | 團隊；使用者資料與產品內計數。 |
| GET `/products/:p/users/:u/feedback` | 團隊；該人建立的產品 Feedback。 |
| GET `/products/:p/users/:u/comments` | 團隊；該人的產品普通／Schedule 留言，不含私人 Tag。 |
| POST `/invitations` | 團隊，email、role、productIds；排入 Email 工作。 |
| GET `/invitations` | 團隊，邀請狀態，不回原始 token。 |
| POST `/invitations/:id/resend` | 團隊，重新寄送並處理舊 token 失效。 |
| DELETE `/invitations/:id` | 團隊，撤銷。 |
| POST `/invitations/accept` | 已登入 Google，token；驗證 Email 與產品集合，交易內接受。 |
| PATCH `/users/:u/role` | 團隊，role、testerProductIds、expectedRevision；最後團隊保護。 |
| DELETE `/users/:u/membership` | 團隊，移除成員資格、撤銷 session，保留歷史作者。 |
| PUT `/products/:p/users/:u/person-tags` | 團隊，personTagIds、expectedRevision（product revision）；[] 表示未安排。 |

頭像工程預設接受 JPEG／PNG／WebP，最大 2 MB，伺服器驗證實際內容並重新編碼／移除多餘 metadata；不接受可執行 SVG。若暫時未提供 Storage，仍可使用 Google 頭像，但不能宣稱個人頭像上傳功能已完成。

## Feedback 與公開互動

| 方法／路徑 | 權限與行為 |
| --- | --- |
| GET `/products/:p/feedback` | 團隊；q、statusId、categoryId、tagIds、cursor。 |
| POST `/products/:p/feedback` | 團隊；完整建立，含 Schedule 草稿。 |
| GET `/products/:p/feedback/:f` | 團隊；內部 DTO，不混入他人個人 Tag。 |
| PATCH `/products/:p/feedback/:f` | 團隊；允許欄位明確列舉，含 visibility。 |
| DELETE `/products/:p/feedback/:f` | 團隊；軟刪除與關聯檢視失效。 |
| GET `/public/products/:slug` | 團隊或該產品受邀測試成員；公開產品入口資訊。 |
| GET `/public/products/:slug/feedback` | 團隊或該產品受邀測試成員；只查 public、未刪除，支援 q。 |
| GET `/public/products/:slug/feedback/:f` | 團隊或該產品受邀測試成員；公開 DTO。 |
| POST `/portal/products/:p/feedback` | 團隊或該產品測試成員；只接受 title、description，後端設 public 與預設分類。 |
| PATCH `/portal/products/:p/feedback/:f` | 自己的公開內容或團隊；只接受 title、description、expectedRevision。 |
| PUT / DELETE `/portal/products/:p/feedback/:f/vote` | 已授權成員，設定／取消本人投票。 |
| GET `/public/products/:slug/feedback/:f/comments` | 團隊或該產品受邀測試成員；僅 general、normal、公開可見留言。 |
| GET / POST `/products/:p/feedback/:f/comments` | 團隊；一般留言串；建立 body、replyToId。 |
| POST `/portal/products/:p/feedback/:f/comments` | 已授權成員；同上，公開 Feedback。 |
| PATCH / DELETE `/products/:p/comments/:c` | 團隊普通留言編輯／移除，檢查 revision。 |
| PATCH `/portal/products/:p/comments/:c` | 作者本人普通留言文字編輯，內容仍可見。 |
| PUT / DELETE `/portal/products/:p/comments/:c/like` | 已授權成員的公開普通留言按讚／取消。 |
| PUT / DELETE `/products/:p/comments/:c/like` | 團隊可對一般或 Schedule 普通留言按讚／取消；Schedule 操作需寫歷史。 |

建立 Feedback 的內部 request：

```json
{
  "title": "讓回饋列表支援鍵盤操作",
  "description": "使用方向鍵移動焦點。",
  "statusId": "<new-post-id>",
  "categoryId": "<discussion-id>",
  "personTagIds": [],
  "priority": "P0",
  "versionTagId": null,
  "tagIds": [],
  "visibility": "internal",
  "scheduleDraft": {
    "actions": [
      { "clientActionId": "<uuid>", "type": "comment.create", "body": "/2-3 規劃焦點順序" }
    ]
  }
}
```

scheduleDraft.actions 由初始第 2 列按順序重播，支援 row.add、comment.create、history.hide 及草稿普通留言編輯等既有動作；引用使用 clientActionId，提交後映射正式 ID。客戶端不送作者、正式時間或任意資料表快照。

`tagIds` 若包含版本群組 Tag，必須與 versionTagId 一致；互相衝突回 422，不能猜誰優先。PATCH 未出現的欄位保留；明確 null 的 versionTagId 清除版本。

## Schedule

| 方法／路徑 | 行為（皆團隊） |
| --- | --- |
| GET `/products/:p/feedback/:f/schedule` | 列、格子項目、revision；不混入普通 Feedback 留言。 |
| POST `/products/:p/feedback/:f/schedule/rows` | expectedRevision；追加一列。 |
| GET `/products/:p/feedback/:f/schedule/comments` | Schedule 留言串分頁。 |
| POST `/products/:p/feedback/:f/schedule/comments` | body、replyToId nullable、expectedRevision；伺服器判斷普通／指令。 |
| GET `/products/:p/feedback/:f/schedule/history` | 可見操作歷史分頁。 |
| DELETE `/products/:p/feedback/:f/schedule/history/:operationId` | If-Match schedule revision；依類型連動移除並新增 history.hide。 |

```json
{
  "body": "/2-3 delete",
  "replyToId": null,
  "expectedRevision": 7
}
```

成功需回傳新 scheduleRevision、comment、operation、affectedCell／affectedEntryIds，前端一次更新。空格清空回 affectedCount=0；語法失敗不留失敗指令留言。一般 Schedule 留言透過普通留言編輯端點更新時，必須同時要求 Schedule revision 並產生操作歷史。

## Roadmap

| 方法／路徑 | 行為（除 public 皆團隊） |
| --- | --- |
| GET / POST `/products/:p/roadmaps` | 列表／建立；name、description、dimension、tagGroupId nullable。 |
| PATCH `/products/:p/roadmaps/:r` | 名稱、描述、sortMode、portalPublished、expectedRevision；不可改 dimension。 |
| DELETE `/products/:p/roadmaps/:r` | 非預設看板刪除，Feedback 保留。 |
| PUT `/products/:p/roadmaps/order` | 完整 roadmapIds 唯一集合、product expectedRevision。 |
| GET `/products/:p/roadmaps/:r/columns` | 欄位、計數、revision。 |
| PATCH `/products/:p/roadmaps/:r/columns/:c` | label、expectedRevision；不可重綁選項。 |
| PUT `/products/:p/roadmaps/:r/columns/order` | 全欄位 IDs 的唯一排列、expectedRevision。 |
| GET `/products/:p/roadmaps/:r/columns/:c/feedback` | 分頁，依伺服器分欄與排序。 |
| POST `/products/:p/roadmaps/:r/moves` | 單卡跨欄／同欄排序，原子更新。 |
| GET `/public/products/:slug/roadmaps` | 只列 portalPublished 的狀態看板。 |
| GET `/public/products/:slug/roadmaps/:r` | 公開看板及只含 public Feedback 的分頁投影。 |

```json
{
  "feedbackId": "<feedback-id>",
  "targetColumnId": "<column-id>",
  "beforeFeedbackId": null,
  "afterFeedbackId": "<neighbor-id>",
  "expectedFeedbackRevision": 6,
  "expectedPlacementRevision": 2
}
```

before 表示放在該卡之前，after 表示放在該卡之後；兩者皆 null 一律解讀為目標欄最頂端（空欄即唯一位置）。客戶端送出畫面上相鄰的兩張卡，且不得是自己。伺服器判定目標實際維度，禁止額外 body 欄位偷偷改類別／Tag。

**併發範圍（移動不檢查整張看板 revision）**

| 情境 | 保護方式 | 結果 |
| --- | --- | --- |
| 看板結構變更（欄位名稱、欄位順序、排序模式、名稱／描述、公開） | `roadmaps.revision`（`expectedRevision`／`If-Match`）；移動不送也不檢查此值 | 結構編輯彼此衝突回 409；移動只有在第一次把看板切成 freedom 時讓 revision +1 |
| 同一筆 Feedback 被同時修改 | Feedback 列鎖；跨欄時檢查 `expectedFeedbackRevision`（同欄不檢查，因不改 Feedback 欄位）；每次移動檢查卡片自己的 `expectedPlacementRevision`（看板卡片與欄分頁回應中的 `placementRevision`，尚無排序紀錄為 0） | 409 `details.reason = "card_changed"`；客戶端重新載入，**不自動重試** |
| 不同卡片的排序操作 | 目標欄列鎖序列化同欄寫入（鎖順序：Feedback 列 → 目標欄列）；看板列以共用鎖讀取 | 不同卡片互不衝突；他人卡片剛好落在同一對相鄰卡之間時，仍視為「放在兩卡之間」並緊接 after 卡之後 |
| 落點已失效 | 相鄰卡離開目標欄，或 before／after 的先後已顛倒 | 409 `details.reason = "order_changed"`，不自動套用；客戶端重新載入後由使用者再放一次 |
| 落點不合法 | 相鄰卡是自己或不存在 | 400 VALIDATION_FAILED |

成功回應：`{ roadmapRevision, feedbackRevision, placementRevision, columnId, previousColumnId }`。`placementRevision` 只出現在內部看板與欄分頁回應，公開投影不含。

## Personal

| 方法／路徑 | 行為（團隊且 owner 固定本人） |
| --- | --- |
| GET `/products/:p/personal?subjectUserId=:u` | 取得本人對 subject 的檢視，沒有時可回初始表示；持久建立使用下一端點。 |
| POST `/products/:p/personal/views` | subjectUserId；冪等取得／建立 view 與預設欄。 |
| PATCH `/products/:p/personal/views/:v` | sortMode、expectedRevision。 |
| POST `/products/:p/personal/views/:v/columns` | name、expectedRevision。 |
| PATCH / DELETE `/products/:p/personal/views/:v/columns/:c` | 名稱／刪欄並移卡；default 不可刪。 |
| PUT `/products/:p/personal/views/:v/columns/order` | 唯一完整欄位順序。 |
| POST `/products/:p/personal/views/:v/moves` | feedbackId、targetColumnId、beforeFeedbackId、afterFeedbackId、expectedRevision；不收 Feedback 業務欄位。 |
| GET / POST `/products/:p/personal/tags` | 本人的私人 Tag；建立 name。 |
| PATCH / DELETE `/products/:p/personal/tags/:t` | 僅本人；改名／移除並解除自己的關係。 |
| PUT `/products/:p/personal/feedback/:f/tags` | personalTagIds、expectedRevision；只能是本人同產品的 Tag。 |

伺服器拒絕任意 ownerId。即使使用者是團隊成員，也不能取得或修改他人的 viewId。回傳 view 的所有卡片須重新符合 subject 責任條件。

## Setting 與 Notification

| 方法／路徑 | 行為 |
| --- | --- |
| GET `/products/:p/taxonomy` | 團隊；狀態、類別、Tag 群組、Tag、Person tag。 |
| POST / PATCH / DELETE `/products/:p/statuses[/:id]` | 團隊；新增／改名／替換後移除，處理 Roadmap 引用。 |
| POST / PATCH / DELETE `/products/:p/categories[/:id]` | 同上。 |
| POST / PATCH / DELETE `/products/:p/tag-groups[/:id]` | 驗證模式、系統版本群組及看板引用。 |
| POST / PATCH / DELETE `/products/:p/tags[/:id]` | 更新影響 Feedback、版本投影與看板欄位。 |
| POST / PATCH / DELETE `/products/:p/person-tags[/:id]` | 影響成員職掌、責任清單與通知接收者。 |
| GET `/products/:p/taxonomy/:kind/:id/usage` | 顯示受影響筆數及相關看板，供移除確認。 |
| GET `/products/:p/notifications` | 本人可見通知，支援未讀／cursor。 |
| PUT `/products/:p/notifications/:n/read` | 本人標記已讀。 |
| PUT `/products/:p/notifications/read` | 本人截至指定時間的可見通知標記已讀。 |

方括號表示路徑模板簡寫，實作時 collection 的 POST 與 item 的 PATCH／DELETE 分開。設定 mutation 要求 product revision；刪除 request 提供 replacementId 或明確 detach 策略，後端驗證可行性，不允許任意 cascade 清空狀態。

## Calendar

| 方法／路徑 | 行為（團隊、後台） |
| --- | --- |
| GET `/integrations/google/calendar/start` | 本人增量授權，記錄安全 returnTo。 |
| GET `/integrations/google/calendar/callback` | 保存本人憑證，授權錯誤不影響平台登入。 |
| GET `/integrations/google/calendar/status` | 已授權 scopes 與狀態，不回任何 token。 |
| DELETE `/integrations/google/calendar/connection` | 解除平台 Calendar 連線，清除儲存憑證並嘗試撤銷專用授權；不刪 Google 活動。 |
| GET `/integrations/google/calendars` | 本人可見日曆與 accessRole，綁定只接受可寫日曆。 |
| GET / PUT / DELETE `/products/:p/calendar/binding` | 查閱／綁定／解除產品日曆；PUT expectedRevision。解除不刪活動。 |
| GET `/products/:p/calendar/events?from=...&to=...` | 本人 Google 權限下的時間窗活動，處理 Google 分頁。 |
| POST `/products/:p/calendar/events` | 建立單次或受支援 recurring 活動，必填 Idempotency-Key。 |
| PATCH `/products/:p/calendar/events/:eventId` | scope=single/series、expectedEtag、bindingRevision、允許編輯欄位。 |
| DELETE `/products/:p/calendar/events/:eventId` | scope、If-Match Google ETag、bindingRevision，確認後移除。 |
| PUT / DELETE `/products/:p/calendar/events/:eventId/feedback-link` | 建立／解除同產品 Feedback 關聯，不改 Schedule／狀態。 |

以實際綁定解析 calendarId，不信任客戶端提供任意 Google calendar ID。事件取得與寫入都必須確認屬目前綁定；bindingRevision 避免操作過程被換日曆後寫錯地方。

```json
{
  "summary": "搜尋功能驗收",
  "description": "檢查鍵盤操作與繁體中文搜尋。",
  "location": "",
  "allDay": false,
  "startDateTime": "2026-10-27T14:00:00+08:00",
  "endDateTime": "2026-10-27T15:00:00+08:00",
  "timeZone": "Asia/Taipei",
  "recurrence": null,
  "feedbackId": "<same-product-feedback-id>",
  "bindingRevision": 2
}
```

回傳 Google event ID、ETag、更新時間及可操作性；不回傳底層 OAuth token。Calendar 專用 code 包含 CALENDAR_REAUTH_REQUIRED、CALENDAR_READ_ONLY、EVENT_CONFLICT、UNSUPPORTED_EVENT_TYPE。外部 412 映射為 409 EVENT_CONFLICT。

## 實作補充（與上表一起閱讀）

以下為實作時補上的端點與確定的細節，不改變上方規則：

| 方法／路徑 | 說明 |
| --- | --- |
| GET `/site` | 目前 host 對應的網站與 provider 模式（real／fake），不含秘密。 |
| GET `/health` | 健康檢查（含資料庫）。 |
| GET／POST `/jobs/run` | outbox 工作入口，需 `Authorization: Bearer <JOB_RUNNER_SECRET 或 CRON_SECRET>`；錯誤 secret 回 404。 |
| POST `/me/avatar-upload` | 直接上傳圖片本體（content-type 為 `image/jpeg`、`image/png` 或 `image/webp`，≤ 2 MB）；伺服器驗證實際內容、重新編碼為 256px WebP 並移除中繼資料。GET `/avatars/:userId` 由伺服器讀取 private bucket。 |
| GET `/products/:p/roadmaps/:r/board?limit=` | 一次取得所有欄位、伺服器計算的筆數與每欄第一頁卡片（內部卡片附 `placementRevision`，供移動檢查）。 |
| GET `/products/:p/personal/feedback/:f/tags` | 本人對該 Feedback 的私人 Tag 與 revision（首次為 0）。 |
| GET `/products/:p/calendar/events/:eventId` | 取得單一活動；整系列編輯先以此讀 master 與其 ETag。 |
| GET／PUT `/portal/products/:p/notifications…` | 測試成員在前台的本人通知（只含可存取的公開內容）。 |
| GET `/public/products` | 前台首頁的產品入口清單（名稱與 slug）。 |
| POST `/test-support/login`、`/test-support/calendar/connect` | **僅開發／E2E**：需 `E2E_TEST_LOGIN=enabled`，production 設定下永遠回 404。 |

其他確定行為：

- 一般留言排序以伺服器接受順序（插入序號）為準；清單 cursor 為不透明字串。
- 普通 Schedule 留言的刪除以 `If-Match: "<comment revision>"` 加查詢參數 `scheduleRevision` 驗證兩個版本。
- 刪除分類選項時 body 帶 `expectedRevision`（product revision）與 `replacementId` 或 `strategy: "detach"`。
- Calendar 寫入若 Google 結果不明，回 **202** `{ state: "unknown", mutationId }`；以相同 Idempotency-Key 重試會先核對 Google（建立以固定 event ID、更新以 `extendedProperties.private.csbLastMutation`）再決定，不盲目重放。
- 所有寫入要求 `Origin` 等於該網站 origin（CSRF 防護）；未列在 schema 的欄位一律 400（禁止 mass assignment）。

## Windows 自架存取修訂（WIN-04）

保留 `/public/` 路由與 public DTO 名稱以降低遷移範圍，但它們不再允許匿名。所有公司資料讀取（含 Roadmap、搜尋、留言、頭像、通知及直接 URL）先驗證 session 與產品／資源資格；未登入 401，無資格資源 404。頁面可導向登入，API 不得以登入頁 HTML 代替 401。只有登入、OAuth callback、邀請接受必要入口及不含敏感內容的健康檢查可例外。快取不得跨使用者洩漏內容，撤銷資格後每次請求重新檢查。這是待實作的新契約，不是宣稱現有測試已通過。
