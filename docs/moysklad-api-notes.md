# MoySklad JSON API 1.2 — verified notes

Verified on **2026-11-07** from the vendor's own documentation source:
GitHub `moysklad/api-remap-1.2-doc`, commit `fb6d231b` (2026-11-05). `master` and `pre_release` (the default
branch) point at the same commit, so they are identical.
The rendered site (`dev.moysklad.ru/doc/api/remap/1.2/`) is client-side rendered and cannot be fetched as plain
HTML, so the markdown source is the reference. Paths below are relative to `md/` in that repo.

**Legend:** ✅ read in the docs · ⚠️ NOT verified, must be checked against the real account (Phase 1b / 5).
Re-verify this file if more than ~3 months pass: limits already changed three times in 2026.

Base URL: `https://api.moysklad.ru/api/remap/1.2`

---

## 1. Auth, transport

| Fact | Source |
|---|---|
| ✅ Auth: Basic (login + password), user Bearer token, or solution (app) Bearer token | `_restrictions.md` |
| ✅ **`Accept-Encoding: gzip` is mandatory.** Missing header or any other encoding → HTTP 415 with an empty body | `_general.md` §3 |
| ✅ Max 1000 rows per page (`limit` 1–1000, default 1000), `offset` paging | `_general.md` |
| ✅ **`expand` only works when `limit ≤ 100`.** With a larger limit it is silently ignored, no error | `_general.md` (expand section) |
| ✅ Timestamps **returned** by the API are in **Moscow time (MSK, UTC+3, no DST)**, format `yyyy-MM-dd HH:mm:ss`. Convert on ingest | `_general.md` "Формат даты и времени" |
| ⚠️ Whether **input** values (`filter=updated>=…`, `changedSince`) are also parsed as MSK is **not stated**. If the server expected UTC, a value sent in MSK would land 3 h in the future; `changedSince` rejects future values and a 5-minute overlap won't absorb a 3-hour skew. Verify empirically in Phase 1b (send a known `updated` back as a filter) | — |
| ✅ Money values are integers in the minor unit (×100): `salePrices[].value`, order position `price` | `_product.md`, `_customerOrder.md` |
| ✅ Max 1000 elements in any array sent in a request body (else 413) | `_restrictions.md` |
| ✅ Request headers ≤ 8 KB total (long `filter=id=…` URLs: keep ≤ ~50 ids per request) | `_restrictions.md` |

## 2. Rate limits (changed in 2026 — design for the strictest)

Basket: **45 units per 3-second window, per user** (since 2026-02-16 it is per user/solution, not per account).
Each request spends *weight* units:

| Auth | Weight | Effective limit |
|---|---|---|
| Solution token, **public or private** solution | 1 | 45 req / 3 s |
| Solution token, solution in status **Draft** or **On moderation**, from 2026-04-13 | 4 | 11 req / 3 s |
| User login+password or user token, from 2026-05-12 | 2 | 22 req / 3 s |
| …from 2026-09-01 (**current as of today**) | 3 | 15 req / 3 s |
| …from **2026-12-01** | 4 | **11 req / 3 s** |
| `GET report/stock/all`, `GET report/stock/bystore` (any auth) | 5 | 9 req / 3 s |

Other limits (✅ `_restrictions.md`):
- ≤ 5 parallel requests per user/solution, ≤ 20 per account. Exceeding gives 429 with error code **1073** (not reflected in the headers).
- ≤ 20 MB per request body. ≤ 4 async tasks queued per account.
- Rate headers on responses (✅ `_general.md`): `X-RateLimit-Limit`, `X-RateLimit-Remaining`,
  `X-Lognex-Retry-TimeInterval` (ms), `X-Lognex-Reset` (ms), `X-Lognex-Retry-After` (ms). Throttling status: **429**.
- ⚠️ Weight of `report/stock/all/current` and `bystore/current` is not documented. Only `/all` and `/bystore` are listed
  at weight 5. Confirm from `X-RateLimit-Remaining` deltas on the first real call.

**Automatic API shutdown** (✅ `_restrictions.md`). MoySklad disables a user's API access after, in the last hour:
> > 200 identical failing requests per minute, **or** > 200 requests/min answered 429, **or** > 100 PUTs/min to the same entity.

Only MoySklad support can re-enable API access. → The client needs a circuit breaker; retries must never loop.

**Tariff limits:** webhooks work **only on paid tariffs (and the trial)**; on the free tariff nothing is sent and webhooks
cannot be created or edited (✅ `_restrictions.md`, `_webhook.md`).

## 3. Webhooks

| Fact | Source |
|---|---|
| ✅ Create: `POST /entity/webhook` with `url` (≤ 255 chars), `action`, `entityType`; optional `diffType` (`NONE`/`FIELDS`, UPDATE only). Admin account or solution with special rights only | `_webhook.md` |
| ✅ Actions: `CREATE`, `UPDATE`, `DELETE`, `PROCESSED` (PROCESSED = async tasks only). Any entity/document type except `webhook`, `discount`, `notes` | `_webhook.md` |
| ✅ 1.2 can only list/edit/delete webhooks that were created through 1.2 | `_webhook.md` |
| ✅ Payload: `{ auditContext:{meta,moment,uid}, events:[{meta:{type,href}, action, accountId, updatedFields?}] }`; `?requestId=<uuid>` query param on the callback | `_webhook.md` |
| ✅ **No signature / HMAC / secret header is documented.** Treat payloads as untrusted hints | `_webhook.md` |
| ✅ Receiver must answer **200 or 204 within 1500 ms**; otherwise 3 immediate retries (no delay); then the event is dropped for good. Retries reuse the same `requestId` → dedupe on it | `_webhook.md` |
| ✅ Header `X-Lognex-WebHook-DisableByPrefix: https://our-domain.tld` on our own API writes suppresses webhooks whose URL starts with that prefix (protocol + full domain required; one header per prefix) | `_webhook.md` |
| ✅ Webhooks auto-disabled if, in 7 of the last 10 days, the receiver only returned errors/was down and never succeeded once in 10 days. Owner gets an e-mail; re-enable via API ourselves | `_restrictions.md` |
| ✅ Receiver TLS certificate chain must be valid | `_webhook.md` |
| ✅ **Stock webhook** `entity/webhookstock` (`stockType: stock`, `reportType: all|bystore`): fires every **1–5 minutes** when stock changed; payload is `{accountId, stockType, reportType, reportUrl}` where `reportUrl` = `…/report/stock/all/current?changedSince=<ts>` | `_webhookstock.md` |

## 4. Stock

Use the **brief report** (`_report_stock.md`). It is built for polling every 5–15 minutes and returns everything in one response (no paging).

- `GET /report/stock/all/current?stockType=<t>` — per assortment item. `GET /report/stock/bystore/current` — per store.
- `stockType` ∈ `stock` (physical), `freeStock` (stock − reserve), `quantity` ("available", accounts for reserve **and in-transit** → can oversell), `reserve`, `inTransit`. **Only one type per request.**
- Response rows: `{ assortmentId, <stockType value> }`. Join to products by `assortmentId` = product/variant `id`.
- Only non-zero stock rows by default; `include=zeroLines` adds zero rows. **A missing row must be treated as 0.**
- `changedSince=yyyy-MM-dd HH:mm:ss` (MSK): returns **current** stock (not a delta) for items that changed since then.
  Always includes zero lines. **Max look-back 24 h**; cannot be in the future. Docs recommend overlapping windows
  (e.g. every 30 min for the last 35 min) and a full sync without `changedSince` at least daily.
- Archived/deleted product in the window → reported with stock 0 (and cannot be fetched by id afterwards).
- Filters: `assortmentId=<uuid[,uuid…]>`, `storeId=<uuid>` (ids, not URLs). Needs admin or "stock" permission.
- The legacy `assortment` endpoint (stock inline) is deprecated and scheduled for removal. The new lightweight one needs header
  `X-Lognex-Remap-Beta-Feature: assortmentWithoutStock` and returns **no** stock fields. (`_assortment.md`)
  → Do not build on assortment; use `entity/product` (+ `entity/variant`) and the stock report.

## 5. Product fields (`entity/product`, `_product.md`)

Available ✅: `id`, `name` (≤255), `description` (**≤4096, plain text**), `code`, `externalCode`, `article`, `archived`,
`updated` (filterable `< > <= >=`), `pathName`, `productFolder` (expand), `uom` (expand), `images` (MetaArray, expand),
`files`, `salePrices[]` (`value`, `currency`, `priceType`), `minPrice`, `buyPrice`, `barcodes[]`, `packs[]`
(`quantity`, `uom`, `barcodes`), `country`, `supplier`, `attributes[]` (custom fields), `weight`, `volume`, `variantsCount`,
`minimumBalance`, `syncId`, `shared`, `vat`. UZ-edition modules: `mod__tasnif__uz`, `mod__marking__uz`.

Facts that shape the design:
- ✅ **There is no `created` field.** "New arrivals" / "newest" need our own `first_seen_at`.
- ✅ **There is no native brand field.** Candidates: a custom attribute (`attributes[]`, schema at
  `GET /entity/product/metadata/attributes`), `supplier`, `country`, or the product folder. The owner decides.
- ✅ `salePrices` is a list, one entry per price type; the price type list is `GET /context/companysettings/pricetype`. Which one is the site price is a business decision.
- ✅ `buyPrice` and `minPrice` are internal → **never expose them**.
- ✅ No stock on the product entity (stock lives in reports only).
- ✅ Product groups: `entity/productfolder` (tree via `productFolder` parent + `pathName`, `archived`, `updated`).
- ⚠️ Archiving a product is *expected* to arrive as an `UPDATE` (the `archived` flag) and hard deletes as `DELETE`, but the docs I read do not state which event each produces. The daily id reconcile covers both cases.
- ⚠️ Whether `entity/product` list hides archived items by default (the stock report accepts `filter=archived=false;archived=true`). Design for both; verify.
- ⚠️ Whether `expand=images` returns image rows inline (it should, at `limit ≤ 100`). Verify.

## 6. Images (`_images.md`)

- `GET /entity/product/{id}/images` → rows with `filename`, `size`, `title`, `updated`, `meta.downloadHref`,
  `miniature` (served from `miniature-prod.moysklad.ru`), `tiny` (`online.moysklad.ru/static/…`). Max 1000 per product listing.
- ✅ Default `downloadHref` is `…/api/remap/1.2/download/<uuid>` on the API host.
- ⚠️ Whether that link requires auth, redirects, or expires is **not stated** in what I read. The docs only say that the *permanent* link below downloads without auth.
- ✅ Paid tariffs: `fields=downloadPermanentHref` gives a permanent link that downloads **without auth** (`_images.md`).
- → We copy images to our own storage rather than hotlinking: for availability (MoySklad downtime or limits must not break the catalog), controlled sizes/formats, and CDN caching. Skip re-download when `filename + size + updated` are unchanged.
- ⚠️ Whether `/download/<uuid>` counts against the request budget (assume yes: worst case 1 request per image).
- ⚠️ Whether `miniature`/`tiny` hosts are outside the budget and large enough for card images (probably too small for detail pages).

## 7. Creating orders (`documents/_customerOrder.md`, `dictionaries/_counterparty.md`, `_states.md`)

- `POST /entity/customerorder`. **Required: `organization` (our legal entity) and `agent` (counterparty).** Everything else optional.
- Useful fields: `name`, `externalCode` (use our order number), `syncId` (UUID, write-once, filterable `=`) → idempotency,
  `description` (comment, ≤4096), `shipmentAddress` (≤255) / `shipmentAddressFull`, `state` (meta), `salesChannel`,
  `deliveryPlannedMoment`, `applicable`, `positions[]` (`assortment` meta, `quantity`, `price` in minor units, `discount`, `reserve`).
- Counterparty: `name` required on create; `phone` (filter `=`), `email`, `actualAddress`, `tags`, `syncId`.
  Phone matching is an exact string → normalise to `+998XXXXXXXXX` on both sides; check existing counterparties' format first.
- Order statuses = `states` (`GET /entity/customerorder/metadata`), `stateType` ∈ `Regular | Successful | Unsuccessful`.
- ✅ A `reserve` on positions is how MoySklad holds stock for the order (reduces `freeStock`).
- ⚠️ Which `organization`, `store`, `salesChannel`, `state` the owner wants new web orders to use.

## 8. Still to verify with a real account (Phase 1b)

1. Tariff; do `POST /entity/webhook` and `POST /entity/webhookstock` succeed?
2. Actual `X-RateLimit-*` values and weights for: list products, `stock/all/current`, image download.
3. Real shape of: `attributes[]` (brand?), `packs[]`, `uom`, `salePrices` (price type names), `images` with expand.
4. Archived-product behaviour in list endpoints and which webhook event archiving produces; `filter=updated>=…` / `changedSince` **input timezone** (MSK vs UTC) and exact format.
5. Number of products / variants / images → initial-sync duration.
6. Counterparty phone formats already in the account.
