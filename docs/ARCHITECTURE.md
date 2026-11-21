# Architecture & implementation plan — Website + Telegram Mini App + MoySklad

Status: **Phase 1 deliverable, awaiting approval. No code has been written.**
Written 2026-11-07. Companion file: [`moysklad-api-notes.md`](./moysklad-api-notes.md) (verified API facts + sources).

Working name used below: `shop` (rename freely).

---

## 1. What we are building (and what drives the design)

One catalog, three front doors, one source of truth:

```
                    ┌──────────── MoySklad (source of truth) ────────────┐
                    │ products · folders · prices · stock · images       │
                    │ orders (customerorder) · counterparties · states   │
                    └───────▲───────────────────────────────┬────────────┘
        orders, counterparty│                               │ polling + webhooks
                            │                               ▼
 Browser ─► Next.js (SSR) ─► Fastify API ◄──Redis──► BullMQ worker (sync, images, order push)
 Telegram ─► Next.js /tma ─►     │                          │
 Admin ───► Next.js /admin ─►    └────────► PostgreSQL ◄───┘   (read model + our own data)
```

Five facts from research drive every decision below (details in the notes file):

1. **MoySklad's rate budget is tight and getting tighter.** From 2026-12-01 a user-token/Basic integration gets
   **11 requests per 3 s** (≈3.7 rps), max 5 in flight, and API access is *switched off* by MoySklad after >200 errors
   or 429s per minute (only support can restore it). → We never call MoySklad from request paths for reads. We keep a local
   read model and one global rate limiter with a circuit breaker.
2. **Webhooks are unsigned, retried only 3× with no delay, must be acked in 1.5 s, and exist only on paid tariffs.** → Webhook =
   hint; we enqueue, ack, then re-fetch the entity ourselves. Scheduled polling must be able to run the whole system alone.
3. **MoySklad has no brand field and no `created` date on products.** → Brand is a configured mapping; "new arrivals" uses our own
   `first_seen_at`.
4. **Stock lives only in reports.** Brief report (`/report/stock/all/current`) joined by `assortmentId`; `changedSince` reaches back
   max 24 h; missing row = 0; `freeStock` is the safe default, `quantity` can oversell.
5. **The reference site (mirl.uz) is a B2B ordering tool; our customers are ordinary shoppers** (owner's answer, 2026-11-07: the owner runs a
   stationery shop and a grocery shop and wants to sell the same range online to the general public). We borrow its *structure*, not its B2B
   ergonomics: grid-first on phones, the dense table view stays as a secondary toggle, pack-size detail is secondary information. Its screenshots show: ~40 brand chips as a primary
   navigation device, a dense table view next to the grid, "pack size" and "unit" columns (`(4)/6/144`, `штук/упаковка/пачка`),
   transliterated-Latin product names, and prices in сум. Weak spots we can beat: no mobile layout (it tells users to download an app),
   stock hidden in the list view, `/categories` is a 404, an empty "Action" column, and a stand-alone Telegram-less experience.

Honest limits to set expectations with the owner:

- **Catalog content is single-language.** Product names and descriptions exist once in MoySklad (currently transliterated Latin).
  The Uzbek/Russian switch localises the *interface*, categories can be localised via an admin-maintained translation table,
  but names/descriptions stay as entered unless the owner adds per-language custom fields in MoySklad.
- **"Popular" sort has no MoySklad source.** We compute it from our own orders (and admin-curated featured slots) — it starts empty.
- **"Special offers" has no native flag.** Either a second price type ("old price"/"promo") or an admin-curated slot — owner's choice.
- Webhooks depend on the owner's tariff; if they don't work, freshness is bounded by the polling interval (stock ≈ 3 min, products ≈ 5 min).

---

## 2. Architecture decision

**One TypeScript monorepo** (pnpm workspaces + Turborepo):

```
apps/
  web/      Next.js (App Router): public site (SEO/SSR), /tma Mini App, /admin panel
  api/      Fastify: public + Mini App + admin REST API, MoySklad webhook receiver
  worker/   BullMQ workers: scheduler, product/stock/image sync, webhook processing, order push
packages/
  db/         Drizzle ORM schema, migrations, typed queries
  moysklad/   typed MoySklad client: auth, global rate limiter, circuit breaker, mappers, Zod response schemas
  shared/     Zod DTOs, money/phone/transliteration utils, i18n message catalogs, constants
  ui/         design tokens + React components shared by site, Mini App and admin
  config/     tsconfig / eslint / tailwind presets
docs/  deploy/  docker-compose.yml
```

**Why this and not the alternatives**

| Choice | Reason | Rejected alternative |
|---|---|---|
| TypeScript end to end | One set of Zod schemas/types shared by API, worker, site, Mini App and admin; one toolchain to type-check/lint/test; Telegram SDKs are TS-first | **FastAPI**: duplicates every schema in two languages; the machine's Python is 3.9 (end-of-life) |
| Separate **API + worker** processes | Sync jobs, the rate limiter and webhook handling are long-running and stateful; they cannot live in serverless route handlers. Webhook receiver must ack in <1.5 s independent of page rendering load | **Next.js route handlers only**: couples deploys, no safe place for background work, harder rate-limit control |
| **Next.js** for web | SSR/ISR for SEO, `next-intl` locale routing, one app serves site + Mini App + admin on one HTTPS origin (Telegram needs HTTPS) | Separate SPA per surface: triple the UI work, inconsistent UX |
| **PostgreSQL** | Relational model, `pg_trgm` search, transactions for orders, JSONB for raw MoySklad payload snapshots | MongoDB/SQLite |
| **Redis** | Required (not optional): BullMQ queues, the *shared* MoySklad token bucket, distributed locks, API rate limiting, short-TTL caches | In-memory limiter (breaks with >1 process) |
| **Fastify + Zod** | Fast, schema-first validation on every route, easy per-route rate limits | NestJS (heavier than needed) |

Current package versions were checked against npm on 2026-11-07: Next 16.4, React 19.3, Tailwind 4.3, Drizzle 0.45,
BullMQ 6.7, Fastify 5.12, Zod 4.6, `@tma.js/sdk-react` 3.0.x. **Pin exact versions at scaffold time.**
Telegram SDK note: `@telegram-apps/*` is the old namespace (`@telegram-apps/init-data-node` is deprecated); current packages are `@tma.js/*`.
For initData validation we implement the documented HMAC check ourselves with `node:crypto` (≈30 lines, unit-tested against Telegram's algorithm) instead of adding a dependency.

**Runtime topology**

- Browser → `web` (Next, same origin). Browser API calls go through a Next rewrite `/api/*` → `api`, so there's no CORS and one cookie domain.
  Server Components call `api` over the internal network.
- `api` and `worker` share only Postgres + Redis. `worker` tells Next to revalidate (`revalidateTag`, secret-protected endpoint) after sync changes.
- Dev: `docker compose up` (Postgres 17, Redis 7). **Neither is installed locally; Docker is.**
  Telegram Mini Apps and MoySklad webhooks both need **public HTTPS** → development needs a tunnel (Cloudflare Tunnel / ngrok).
- Prod default (to confirm): a single VPS, Docker Compose, Caddy (automatic HTTPS), nightly `pg_dump`.

---

## 3. Data model (PostgreSQL)

Principle: **MoySklad-owned columns are only ever written by the sync code.** Our own data (content, orders, customers, flags) lives in separate tables that *reference* products — never a second, editable copy of product data.

| Table | Key columns / notes |
|---|---|
| `integration_settings` | key/value config: price type id, old-price type id, stock type + store ids, brand attribute id, organization/store/sales-channel/state ids for orders, step-by-pack flag, **`reserve_on_create`** (default: off for guest web orders), counterparty-matching policy |
| `categories` | `ms_id` unique, `parent_id`, `name`, `path_name`, `slug`, `archived`, `ms_updated_at`; `category_i18n(category_id, locale, name)` for admin-maintained uz/ru labels |
| `brands` | `id`, `name`, `slug`, `logo_key?`, `source_value` (attribute value / supplier id) |
| `products` | `id` uuid, **`ms_id` unique**, `ms_type` (`product`\|`variant`), `parent_product_id`, `name`, `name_search` (normalised), `article`, `code`, `external_code`, `description`, `category_id`, `brand_id`, `uom`, `packs` jsonb, `price` bigint (**UZS integer**, = `value/100`), `old_price`, `archived`, `ms_updated_at` (UTC), `first_seen_at` (NULL for the initial import), `content_hash`, `synced_at` |
| `stock_levels` | `product_id`, `store_id` (nullable = all stores), `free_stock`, `stock`, `reserve`, `in_transit`, `updated_at`; `products.available_qty` denormalised for fast filters |
| `product_images` | `product_id`, `ms_image_id`, `position`, `filename`, `size`, `ms_updated_at`, `storage_key`, `w`, `h`, `status` |
| `banners`, `featured_slots`, `content_blocks`, `pages` | **Ours** (admin-managed): banners (image, link, locale, schedule), `featured_slots(slot: featured\|new\|offers\|bestseller, product_id, position, active_from/to)`, localised text blocks |
| `customers` | `telegram_id` unique nullable, `phone`, `name`, `language`, `ms_counterparty_id`, `created_at` |
| `addresses`, `favorites`, `carts`, `cart_items` | server cart for Mini App / logged-in; guest web cart lives in the browser |
| `orders` | `id` uuid, `number`, `customer_id`, `channel` (`web`\|`tma`), `status`, **`idempotency_key` unique**, **`ms_sync_id` uuid**, `ms_order_id`, `ms_state`, totals, contact snapshot (name/phone/address/comment), `created_at`; `order_items` snapshot (name, article, unit price, qty — copied at order time) |
| `admin_users`, `admin_sessions`, `audit_log` | argon2id password hash, optional TOTP secret, who-did-what |
| `sync_runs` | `kind` (full/incremental/stock/images/reconcile/order_push), `status`, `started_at`, `finished_at`, `counts` jsonb, `error` |
| `sync_state` | watermarks (`products_updated_cursor`, `stock_changed_since`), checkpoint offsets for resumable full sync |
| `webhook_events` | **`request_id` unique** (dedupe), `entity_type`, `action`, `href`, `received_at`, `processed_at`, `status` |

**Duplicate prevention:** unique `ms_id`; every sync write is `INSERT … ON CONFLICT (ms_id) DO UPDATE`; `content_hash` lets us skip unchanged rows; orders are unique on `idempotency_key` and `ms_sync_id`.

**Variants (MoySklad "modifications"):** schema supports them (`ms_type`, `parent_product_id`); whether v1 ships them depends on whether the owner uses them (open question).

**Visibility rule:** a product is public iff not archived in MoySklad, has a price, and (optionally) an image. The only storefront overlay we allow is a separate admin `hidden` flag table — it never edits product data.

---

## 4. MoySklad integration design

### 4.1 Client (`packages/moysklad`)
- Auth: a token for a **dedicated MoySklad employee** created for this integration (limits are per user, so we don't compete with staff;
  that employee needs permission for products/stock/orders/counterparties and admin rights if we are to register webhooks).
  A token from a **public or private** MoySklad solution is an alternative with a bigger basket (45/3 s). Careful: a solution in **Draft** or **On moderation** status gets the *strict* 11/3 s limit, so it only helps once the solution is approved. To evaluate with the owner.
  Credentials live only in server env vars; the web app never imports this package.
- Always sends `Accept-Encoding: gzip`. All responses validated with Zod; unknown fields tolerated, missing required fields fail loudly into `sync_runs`.
- **One global token bucket in Redis**, shared by api and worker: capacity 11 per 3 s, **≤5 concurrent**. Two lanes:
  *interactive* (checkout: counterparty lookup/create, order create) can always draw; *background* (sync) may use at most ~8 per 3 s and
  yields whenever interactive work is waiting. Limits are adjusted from the `X-RateLimit-*` headers of real responses.
- **429/5xx handling:** wait `X-Lognex-Retry-After` (+jitter), bounded exponential back-off, max N attempts. **Circuit breaker:**
  ≥ 20 failures/429s in a minute → breaker opens for 5 min, background jobs pause, admin gets a Telegram alert. (MoySklad's cut-off is 200/min; we trip at 10 % of that.)
  Never retry non-idempotent calls blindly (see §6).

### 4.2 Sync jobs (worker, BullMQ; every run recorded in `sync_runs`)

| Job | Trigger | What it does |
|---|---|---|
| **Initial full sync** | manual from admin / first boot | folders (+ price types, uoms, attribute metadata) → products at `limit=100&expand=productFolder,images` (expand needs ≤100) → full stock (`stockType=freeStock&include=zeroLines`). **Resumable** via `sync_state` offset; idempotent upserts. `first_seen_at` stays NULL |
| **Incremental products** | every ~5 min + webhook | `filter=updated>=<watermark − 5 min overlap>` (MSK) ordered by `updated`; upsert; advance watermark only after commit |
| **Stock** | every ~3 min + `webhookstock` | `changedSince = last_ok − 5 min` (never > 24 h back); batch-upsert; **daily full pass** without `changedSince`, which also zeroes items absent from the report |
| **Folders** | every ~30 min + webhook | full list (tiny) |
| **Images** | queued per changed product | compare `filename+size+updated`; download → `sharp` → 3 WebP/AVIF sizes (≈160 / 400 / 1000 px) under content-hashed keys on our storage; **first image of each product first**, the rest in the background |
| **Reconcile (deletions)** | daily | list all ids (`limit=1000`, no expand), diff against DB; hard-deleted → soft-hide. Archiving is expected to arrive as `UPDATE` (⚠️ unverified); the daily diff catches it either way |
| **Webhook processing** | per event | dedupe on `requestId`; coalesce hrefs for ~10 s; re-fetch the entities with our own credentials (`filter=id=…`, ≤50 per request); run the same upsert code as polling |
| **Webhook health** | daily | `GET /entity/webhook` + `webhookstock`: verify each is `enabled`, re-register/enable if not (MoySklad disables them silently after repeated failures) |

**Webhook receiver (in `api`):** `POST /webhooks/ms/:secret` — secret path segment (32 random bytes, in env, ≤255 chars total URL), check `events[].accountId` equals our account,
insert `webhook_events` (unique `request_id`), enqueue, return `200` immediately (target <100 ms). No business logic inline.
When *we* write to MoySklad we send `X-Lognex-WebHook-DisableByPrefix: https://<our-domain>` so our own order writes don't echo back.
Webhooks to register: `product` (CREATE/UPDATE/DELETE), `productfolder`, `variant` (if used), `customerorder` UPDATE (status changes made by staff), `webhookstock`.

**Time zones:** MoySklad *returns* timestamps in MSK (UTC+3, no DST). Parse as `Europe/Moscow` on ingest and store `timestamptz`.
⚠️ The docs do not say how `filter=updated>=…` and `changedSince` *interpret* input. The Phase 1b probe must test this (send back a known `updated` value and compare results) **before** the incremental jobs are written; a 3-hour skew would be silent for `updated` and would make `changedSince` fail as "in the future". The timezone handling lives in one function so the answer is a one-line change.

### 4.3 Budget math (assumptions are marked; the real numbers come from Phase 1b)

- Ceiling: 11 req / 3 s ≈ 3.7 rps; our background lane: 8 req / 3 s ≈ 2.7 rps.
- **Steady state** (stock every 3 min, products every 5 min, folders every 30 min, webhook refetches, daily jobs): ≈ 30–60 requests/hour — **well under 1 %** of the ceiling.
- **Orders:** ~3 requests each (counterparty lookup, create-if-missing, create order) + state refresh. Even 100 orders/hour ≈ 400 requests/hour.
- **Initial sync** (assume 5,000 products): ≈ 50 product pages + ~10 reference calls + 1 stock call ≈ **60 requests ≈ 25 s**.
- **Images are the long pole.** If every download costs one request: 5,000 main images ≈ **30 min**; 10,000 images (2 per product) ≈ **60 min** at 2.7 rps.
  Mitigations: main image first (catalog is usable early), skip unchanged, cap at 5 images/product, and check whether `miniature` hosts are free of budget.
  *The catalog is browsable as soon as products + stock are in; images fill in behind it.*

### 4.4 Product mapping rules (all configurable in `integration_settings`, editable in admin)
- **Price** = the configured price type's `salePrices[].value / 100`, stored as integer UZS. `buyPrice`/`minPrice` are never read into public tables or API DTOs.
- **Stock shown / used for "in stock"** = `freeStock` summed over the configured stores. (`quantity` includes in-transit and can oversell; offered as an option, not the default.)
- **Brand** = value of a configured custom attribute (picked in admin from `/entity/product/metadata/attributes`), fallback `supplier`, else none.
- **Pack/unit:** `uom` + `packs[]` → "в упаковке / ед. изм." displayed like mirl. Whether the quantity stepper increments by pack size is a flag.
- **Category** = the product's folder; the tree comes from `productfolder`/`pathName`.
- **Description** is plain text ≤4096 chars; rendered as paragraphs, never as HTML.

---

## 5. Search

- Product names are transliterated Latin ("Shtrikh korrektor") but customers will type Cyrillic ("штрих") or other Latin spellings ("shtrix").
  → `products.name_search` holds a **normalised skeleton** (lower-case; Cyrillic→Latin map; collapse `kh/x/h`, `sh/ш`, `ch/ч`, `ya/я`, `yu/ю`, `yo/ё`, `oʻ/o'`, apostrophes; strip punctuation). The query is normalised the same way.
- Postgres `pg_trgm` GIN index on `name_search`, plus exact/prefix match on `article`, `code`, `barcodes`. Ranking: article exact > article prefix > trigram similarity.
- `/search/suggest` (debounced 150 ms, ≤8 results incl. brand + category hits) and a full `/catalog/products?q=` endpoint.
- The normaliser is tested against a corpus from the real catalog in Phase 5. If it proves insufficient or the catalog passes ~50k SKUs, swap the engine behind the same API for Meilisearch.

---

## 6. Cart, checkout, orders

**Rules:** the client never sets prices or totals. The server re-reads price and `free_stock` for every line at checkout.

Flow (`POST /orders`, header `Idempotency-Key`):
1. Validate body with Zod; rate-limit (IP + phone); for guest web checkout verify the bot-challenge (Cloudflare Turnstile); honeypot field.
2. Re-price and re-check stock from our read model; reject lines that fail (409 with per-line reasons).
3. In one DB transaction: insert `orders` + `order_items` (status `pending_sync`), unique on `idempotency_key` → a double-click returns the same order.
4. Enqueue `order_push` (the customer already sees "order received"):
   - generate `ms_sync_id` **before** the first call and persist it;
   - counterparty: see the matching policy below; if none is attached, create one (`name`, `phone`, `actualAddress`, `syncId`, tag `web-unverified`);
   - `POST /entity/customerorder` with `organization`, `agent`, `externalCode = our order number`, `syncId`, `shipmentAddress`, `description` (comment + channel), positions (price in minor units; `reserve` per the reserve policy below), initial `state`;
   - **on retry or timeout, first query `customerorder?filter=syncId=<uuid>`** so a lost response never creates a duplicate;
   - send `X-Lognex-WebHook-DisableByPrefix`.
5. Status: `orders.ms_state` is a cache of the MoySklad state; staff change state in MoySklad → `customerorder` UPDATE webhook (or polling of open orders) → we update and notify the customer through the bot. Changing status in *our* admin writes through to MoySklad (`PUT … state`) — one source of truth. (Alternative = local-only statuses; open question.)
6. If MoySklad is down or the breaker is open, orders stay `pending_sync`, are retried with back-off, and appear in an admin "stuck orders" list. Customers are never blocked by MoySklad downtime.

**Reserve policy (abuse risk of guest checkout).** A MoySklad `reserve` lowers `freeStock`, so if every anonymous order reserved stock, one visitor could
send many orders and make real products show "out of stock". Controlled by `integration_settings.reserve_on_create`:
- **Default for guest web orders: off** — the order is created without `reserve`; staff confirm it, and reserving happens when the order is moved to a
  configured "confirmed" state (or by staff in MoySklad).
- Mini App orders (Telegram-identified, rate-limited per `telegram_id`) may reserve on create if the owner wants it.
- Optional cap on open reserved orders per phone / per Telegram user, plus a total-reserved-value alert in admin.

**Counterparty matching policy (impersonation risk).** The phone number typed by a guest is unverified. If we auto-attached it to an existing counterparty, a guest could file orders under a real wholesale client. Default:
- Guest orders attach **only to counterparties created by the site** (tagged `web-unverified`, matched by phone + our own `syncId`/telegram id).
- A matching *pre-existing* counterparty (created by staff) is **not** auto-attached; the order gets a new web counterparty and the description names the possible match so staff can merge. Telegram-identified users may later be linked by staff.
- Alternative (owner's call): trust the phone and match staff-created counterparties anyway.

Payment: v1 = cash / bank transfer on delivery/invoice. Click/Payme are out of scope unless requested.

---

## 7. Authentication & security

| Surface | Mechanism |
|---|---|
| **Mini App users** | `POST /auth/telegram` with raw `initData`. Backend: parse → data-check-string (sorted `key=value`, `\n`-joined, excluding `hash`) → `HMAC_SHA256(bot_token, "WebAppData")` as key → compare `hash` with `timingSafeEqual` → reject if `auth_date` older than ~24 h (configurable) → upsert `customers` by `telegram_id`. Returns a short-lived **bearer token** held in memory (not a cookie: inside web.telegram.org the app runs in a third-party iframe where cookies are unreliable). `initData` is never logged. |
| **Website customers** | v1: guest checkout (name + phone), optional "sign in with Telegram" (Login Widget / bot deep link) to see order history. Phone-OTP login only if the owner wants it (needs an SMS provider) |
| **Admin** | e-mail + password (argon2id), mandatory strong password policy, login rate limiting + lockout, optional TOTP (Phase 8), httpOnly `Secure` `SameSite=Lax` session cookie stored server-side (Redis/Postgres), CSRF via origin check + non-simple header, audit log of every mutation |
| **MoySklad webhooks** | secret path + accountId check + payload treated as a hint (entity is re-fetched) + `requestId` dedupe |

Baseline controls: Zod validation on every route (body, query, params); per-route rate limits backed by Redis; security headers + CSP
(allow `telegram.org` script/frame only on `/tma`); parameterised queries only (Drizzle); least-privilege DB role for the app; all secrets
(`MOYSKLAD_TOKEN`, `TELEGRAM_BOT_TOKEN`, session/JWT keys, webhook secret, Turnstile secret) only in server env, `.env.example` committed with
placeholders; **CI check that greps the built web bundles for secret patterns and fails on any `MOYSKLAD`/token string**; the web workspace
cannot import `packages/moysklad` (lint rule); log scrubbing for tokens/initData/phones; orders cannot be created without a valid
Idempotency-Key and passing abuse checks.

---

## 8. Product, UX and design direction

**Direction: legible, trustworthy, uncluttered retail for a phone-first audience.** (Originally drafted as "quiet wholesale"; revised after the owner
confirmed the buyers are ordinary shoppers. The concrete visual world — palette, type, signature move — is chosen in Phase 2 through the Impeccable direction
round and recorded in `DESIGN.md`; the bullets below are the constraints every candidate must satisfy, not the final look. Product context: `PRODUCT.md`.)

- **Inspired by mirl.uz's structure, not its pixels:** persistent search + big brand strip, grid/**table** toggle, filter sidebar, rails for
  *Promotions / Bestsellers / New*, price + unit on every card. Phones first; the table view is a secondary toggle on desktop. We fix what's weak
  (mobile-first, visible stock, working category index, real empty/error states).
- **Palette (constraints):** one accent colour used only for things you can press; a small fixed stock-status set (in stock / low / out). No gradients, no glass, no decorative blobs. Final accent/logo from the owner's brand (none exists yet; placeholder wordmark "Shop").
- **Shape & depth:** 8 px radius (cards 10 px max — explicitly *not* the oversized 24 px+ rounding), 1 px hairline borders instead of shadows, elevation only for overlays.
- **Type (constraints):** faces chosen in the direction round must cover full Cyrillic + Uzbek Latin (`oʻ gʻ`) — verified by rendering, not assumed; tabular figures for prices and quantities; a monospace face for SKU/article. Spacing on a 4 px grid; type scale 12/14/16/20/28/40.
- **Product card:** image (1:1, neutral background, `object-contain`), brand, name (2-line clamp), article (mono), pack/unit line, price, stock badge, quantity stepper + add. Grid and dense **row** variants share one component API.
- **Motion:** only state feedback (press, add-to-cart confirmation, sheet open/close); honours `prefers-reduced-motion`.
- **i18n:** `next-intl`, locales `ru` and `uz` (Latin script), prefix routing `/ru/…` `/uz/…`, `hreflang`, language switcher in header and Mini App profile. All strings in catalogs from day one; UZS formatted with `Intl.NumberFormat` (`1 234 500 сум` / `so'm`).
- **Accessibility:** WCAG AA contrast, visible focus, 44 px touch targets in the Mini App, keyboard-operable filters and steppers.
- **Tooling:** in Phase 2 the `impeccable` design skill is used for the design-system critique/polish pass; screenshots at 375 / 768 / 1440 are part of the phase gate.

### Website (`(site)` route group)
Home (header with logo/search/language/cart/Telegram entry, hero banners, brand strip, popular categories, Featured / New / Offers rails, footer with contacts) ·
Catalog (grid/table toggle, category + brand + price + in-stock filters, sort: price ↑↓ / popular / newest, URL-based pagination for SEO) ·
Product (gallery, name, SKU, description, price, stock, pack/unit, quantity stepper, add to cart, related) ·
Cart & checkout (lines, qty, remove, totals, name/phone/address, submit, confirmation) · Brands index · Category index · static content pages.

**SEO:** SSR/ISR pages with `revalidateTag` on sync, JSON-LD `Product`/`Offer`/`BreadcrumbList`, canonical + `hreflang`, sitemap (products, categories, brands, both locales), robots, OG tags, clean slugs (`/ru/p/<slug>-<shortid>`), image dimensions set to avoid layout shift. Targets: LCP < 2.5 s and CLS < 0.1 on mid-range mobile.

### Telegram Mini App (`/tma` route group; same API, same components, bottom-tab shell)
Tabs: **Home · Catalog · Favorites · Cart · Profile**. `@tma.js/sdk-react`: theme params mapped to CSS variables (light/dark follows Telegram),
`BackButton` bound to the router stack, **`MainButton`** as the primary CTA ("Go to cart" → "Place order · 1 250 000 сум"), haptics on add-to-cart / success / error,
safe-area insets, viewport expansion. Order history with live status, re-order, language switch. Infinite scroll in lists; the same table/grid components in a compact layout.
Bot side: menu button / `/start` opens the Mini App; order-status messages sent from the worker.

### Admin (`/admin`, Russian UI first)
Dashboard (sync health, stuck orders) · Products (read-only view of synced data + stock + image status; per-product *featured/hidden* overlay) · Sync (status, last runs and errors, run buttons: full / stock / images, webhook health, settings: price type / stores / brand attribute / order org) ·
Orders (list, details, change status → written through to MoySklad) · Customers · Banners · Featured slots · Content blocks / pages. **No product-field editing anywhere** — the UI says "managed in MoySklad".

---

## 9. API surface (Fastify, `/v1`, Zod-validated)

`GET /home` · `GET /categories` · `GET /brands` · `GET /catalog/products` (q, category, brand[], price range, in_stock, sort, page/limit) · `GET /products/:slug` + `/related` ·
`GET /search/suggest` · `POST /auth/telegram` · `GET/PUT /me` · `GET/POST/DELETE /favorites` · `GET/PUT /cart` · `POST /orders` · `GET /orders` · `GET /orders/:id` ·
`POST /webhooks/ms/:secret` · `/admin/*` (separate auth) · `GET /health`, `GET /ready`.
No endpoint proxies MoySklad to the client.

---

## 10. Phases, deliverables, exit gates

**Every phase gate:** `pnpm typecheck` · `pnpm lint` · `pnpm test` all green, then a written report of what now works and what is deferred. A failing gate is fixed before the next phase starts.

| # | Phase | Delivers | Exit criteria beyond the common gate |
|---|---|---|---|
| **1** | **Analysis & architecture** *(this document)* | this file, API notes, decisions | you approve the stack, design direction and answers to the blocking questions |
| **1b** | *(recommended)* **Read-only API probe** | a script that, given the real token, prints the real field shapes (brand attr, packs, price types, images, counts), the rate-limit headers/weights, and webhook capability — no writes | every ⚠️ item in the notes file resolved or consciously accepted. Needs the token, nothing else |
| 2 | **Foundations + design system** | monorepo, Docker Compose (Postgres/Redis), DB schema + migrations, **seed script with realistic fixtures in the real schema**, tokens, `packages/ui` components (button, input, card grid/row, price, stock badge, stepper, filters, tabs, sheet, skeleton, toast), i18n scaffold, a `/dev/ui` gallery | reviewed screenshots at 375/768/1440, a11y checks, no hard-coded colours/spacing outside tokens |
| 3 | **Website** | read API + all site pages above against the seeded data, SEO plumbing, language switch | Lighthouse mobile ≥ 90 perf/SEO/a11y on home, catalog, product; Playwright e2e of browse → filter → product |
| 4 | **Telegram Mini App** | `/tma` shell, SDK integration, auth route, MainButton/BackButton/haptics, favorites/profile/history (against seed + local auth) | e2e with a mocked `Telegram.WebApp`; manual run inside real Telegram through the tunnel |
| 5 | **MoySklad integration** | client, limiter, breaker, all sync jobs, webhook receiver, image pipeline, admin sync page (basic), settings | **contract tests** against recorded fixtures incl. 429/5xx/timeout; resumable full sync proven by killing it mid-run; breaker proven by a fault-injection test; real-account run reports counts, duration, header values |
| 6 | **Cart & checkout** | server cart, `POST /orders`, `order_push` with `syncId` idempotency, counterparty matching, status sync, notifications | tests: double-submit, lost response then retry, price tampering, out-of-stock race, MoySklad down |
| 7 | **Admin panel** | all admin pages above | e2e: change order status writes through; banners/featured appear on site; no product-field editing possible |
| 8 | **Authentication & security** | admin auth hardening (lockout, TOTP), CSP/headers, rate-limit tuning, secret-leak CI check, dependency audit, threat-model review | the security checklist in §7 each backed by a test or a CI check |
| 9 | **Testing & optimisation** | load test of catalog/search, query/index tuning, cache strategy, image budget, error/empty states pass | p95 catalog API < 150 ms on realistic data; budgets enforced in CI |
| 10 | **Deployment prep** | prod Compose, Caddy, env templates, backups + restore drill, logging/alerts (sync stalled, breaker open, webhook disabled), runbook, go-live checklist | restore drill succeeded; a clean-machine deploy from docs works |

---

## 11. Risks and how the plan handles them

| Risk | Mitigation |
|---|---|
| Rate limit tightens again / API gets switched off | One shared limiter sized for the strictest published tier, breaker at 10 % of MoySklad's cut-off, local read model so users never trigger reads, alerting |
| Webhooks unavailable (tariff) or silently disabled | Polling is the baseline; daily webhook health check re-enables; webhooks only reduce latency |
| Stale/incorrect stock → overselling | `freeStock` default, server-side re-check at checkout, reserve policy (§6), daily full stock pass, stock "as of" timestamp shown in admin |
| Anonymous orders locking stock / hijacking a real client's counterparty | Reserve off by default for guest orders; guests attach only to site-created `web-unverified` counterparties; Turnstile + per-IP/phone limits |
| Duplicate orders / counterparties | Idempotency-Key + unique `ms_sync_id`; query by `syncId` before any retry; phone normalisation |
| Brand/price/stock mapping differs from owner's mental model | Mappings are config, discovered by the Phase 1b probe, editable in admin |
| Search misses Cyrillic ↔ Latin variants | Skeleton normalisation + test corpus from real data; engine swappable |
| Image volume slows the first sync | Main image first, skip unchanged, catalog usable before images finish |
| Single-language catalog content | Stated up front; interface localised, optional per-language custom fields later |
| Secrets leaking to the browser | Package boundary lint rule + bundle-grep CI check |

---

## 12. Open questions

**Decisions recorded 2026-11-07 (owner's answers):**
- **Checkout:** guest checkout (name + phone) with rate limits and a bot challenge; **order statuses live in MoySklad states** (our admin writes through, staff changes flow back via webhook/polling).
- **Price + stock:** one **retail price type**, **`freeStock`**, **all warehouses summed** (recommended defaults). Exact price-type and warehouse names still to be picked from the probe's listing; both stay in `integration_settings`.

**Still open — to be settled by Phase 1b (owner answered "not sure"), blocking Phase 5:**
1. MoySklad **tariff** — are webhooks available? (Free tariff: no webhooks at all.) Plan: build polling-first regardless; the probe attempts to register a webhook and reports the result.
2. Where does **brand** live — custom attribute, supplier, country, or product group? The probe lists the custom fields and sample values, plus the distinct suppliers, for the owner to choose from.
3. Exact **price-type name** (and whether an old/promo price type exists) and the **warehouse list**.

**Non-blocking (defaults in brackets):**
- Approximate number of products / variants (modifications) / images per product.
- Which MoySklad **organization**, store, sales channel and initial state new web orders should use.
- Hosting and domain [one VPS + Docker Compose + Caddy; a real domain — Telegram needs HTTPS]; Telegram **bot** username and token (BotFather).
- Brand assets: logo, brand colours, contact details/footer text, delivery rules, minimum order, working hours.
- Prices public, or visible only after sign-in (some wholesalers hide them) [public, like mirl].
- Quantity step = pack size? [step 1 unit + "add pack" shortcut]. Admin UI language [ru].
- **Reserve on order creation** for guest web orders [off; reserve when staff confirm — prevents anonymous stock-locking].
- **Counterparty matching** for guest orders [only attach to site-created, `web-unverified` counterparties; never auto-attach to staff-created ones].
- Phone verification by SMS (Eskiz etc.) [no — Telegram + rate limits].
- Uzbek script [Latin].

**Next step if approved:** Phase 1b (needs only a MoySklad token for a dedicated user — I never need it in chat; it goes in a local `.env`), then Phase 2.
