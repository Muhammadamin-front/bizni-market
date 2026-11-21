# Build status (checkpoint file)

Updated at every slice gate. If you are resuming after a context reset: trust this file, then run `pnpm check`.

**Definition of done for the "before tokens" milestone:** the only things left to do are
(1) put `MOYSKLAD_TOKEN` in `.env`, (2) put `TELEGRAM_BOT_TOKEN` in `.env` and run `pnpm telegram:setup`, (3) set `PUBLIC_URL` to the real domain.
Nothing is rebuilt and no code changes for those three. Every MoySklad id (price type, stores, organisation, order states, brand attribute)
is an `integration_settings` row picked in the admin from live MoySklad lists.

Legend: ✅ done and verified · 🟡 done, verified only against synthetic fixtures · ⏳ in progress · ❌ not started · ⏸ deliberately deferred

## Manual catalogue (no MoySklad yet) — added 2026-11-13
The shop runs fully WITHOUT MoySklad (`MOYSKLAD_TOKEN` empty): the owner manages everything in /admin, MoySklad can be connected later.
- **Data:** `products.source` / `categories.source` = `moysklad | manual` (migration `0001_manual_catalog`); manual rows get a generated UUID in `ms_id`.
  Every sync path is scoped to `source = 'moysklad'` (folders archive, product reconcile, stock recompute, image download), so connecting
  MoySklad later never archives, zeroes or overwrites manual data (tested).
- **Admin:** Товары (list with photos, search incl. barcode, filters, inline price/stock edit, show/hide), product form (photos with
  drag-drop/camera, order/main/delete, live storefront card preview, "save and add another", Ctrl+S, unsaved-changes guard), Категории
  (uz/ru names, nesting with loop guard, order, delete keeps products), settings split into shop vs MoySklad, Sync hidden when not connected.
- **Photos:** `core/media.ts` turns every product photo (manual uploads AND MoySklad downloads) into a 1:1 white square with an even margin:
  EXIF rotate, CMYK→sRGB, transparency flattened onto white, plain white border trimmed (threshold 10), contain (never crop/stretch).
  The browser downsizes to ≤2000 px JPEG before upload (HEIC via Safari). Refused with a clear reason: <64 px, >15 MB, unreadable.
  Verified on tall, wide, tiny, transparent, EXIF-rotated, CMYK, 8.5 MB, HEIC (refused server-side; converted client-side), garbage inputs.
  Storefront frames are white and unpadded for photos (site, Mini App light + dark, cart, gallery); the favourite heart has its own chip.
- **Orders:** with no MoySklad, or when an order contains a manual product, the order is `sync_status = 'local'`: never pushed, never
  marked failed; admin sets a fixed status list (Новый/Подтверждён/Доставляется/Готов к выдаче/Выполнен/Отменён) shown to the customer in
  uz/ru and sent via Telegram. Manual stock is taken atomically at checkout and given back on cancel (un-cancel takes it again).
- **Behaviour change (deliberate):** before, an order placed while MoySklad was not connected was queued and pushed once a token arrived.
  Now it is handled locally and never pushed later (staff will already have fulfilled it). The core test was rewritten accordingly.
- **Ops:** `deploy/backup.sh` now also archives the photo folder (uploads are not re-downloadable). No token ⇒ no "Demo rejim" banner.
- **Freshness:** admin edits (products, photos, categories, banners) expire the site's cached pages with `{ expire: 0 }`, so the next view is
  fresh — verified on `next build && next start` (price 3 500 → 4 200 on the very next page view). Background syncs keep stale-while-revalidate.
- **Banners:** uploads go through the same browser downsizing; the admin shows the exact 16:7 crop the home page uses, with a 1600×700 hint
  (banners are cropped to fill, by design; the Mini App shows no banners).
- Verified: `pnpm check` (183 tests), `next build`, bundle secret scan, and a headless-Chrome walk on a fresh DB with no token
  (login → categories → 3 products with awkward photos → list inline edit → site catalogue/product → Mini App light/dark → order → admin
  status → customer sees it in ru). 390 px: no horizontal scroll on admin list, admin form, site catalogue.
- Not done: bulk import (Excel/CSV), product variants, linking manual products to MoySklad products by article when it is connected.

## Bizni Market name + bilingual admin — added 2026-11-14
- **Shop name** is "Bizni Market" (`brand.name` in `packages/shared/src/i18n/{uz,ru}.ts`, Mini App title, admin title, TOTP issuer). Still
  hardcoded; it could become an admin content block later.
- **Admin in Uzbek and Russian.** Every admin text is written in place as `t("русский", "oʻzbekcha")` (`components/admin/i18n.tsx`);
  label tables are `{ ru, uz }` pairs. UZ/RU switch on the login page and in the header, remembered per browser (`localStorage`
  `admin_lang`, in-memory fallback); **first visit opens in Uzbek** (`DEFAULT_ADMIN_LANG`). Money suffix soʻm/сум, order statuses,
  confirm dialogs, upload errors, dashboard warnings (API now returns `{ ru, uz }`), the live card preview follow the choice.
- Verified: typecheck, lint, 183 tests; headless-Chrome walk on a fresh DB (no token) in both languages at 390 and 1280 px: login,
  create category + product (incl. an Uzbek validation error), every admin page, no horizontal scroll, no leftover Russian on Uzbek
  pages (only the JSON example `"кг"`), the storefront title/header show "Bizni Market". `scripts/smoke.mjs` sets `admin_lang=ru`.
- Hosting: the owner asked for Vercel/Netlify. That hosts only the Next.js part; api, worker, Postgres, Redis, media disk and the
  mock need a server. Options given: Cloudflare quick tunnel from this Mac (today), a VPS with `deploy/docker-compose.yml`
  (recommended), or Vercel + 4–5 managed services. Decision pending.

## Office server deployment (no Docker) — prepared 2026-11-14
- Target: the office Ubuntu 24.04 host shared with the client's CRM, behind its Cloudflare Tunnel. Runbook: [DEPLOY-SERVER.md](DEPLOY-SERVER.md).
- `deploy/server/`: `build-release.sh` (glibc build in Debian, Node bundled, from HEAD), `install.sh stores|release|check`, sandboxed systemd
  units (loopback only, writes only to `/srv/biznimarket/data`), daily backup timer, `cloudflared-route.sh` (backup → insert → validate → restart).
- Code changes for it: `API_HOST` (bind address), `CLIENT_IP_HEADER` (rate limits keyed on `cf-connecting-ip`; test added),
  `NEXT_ISR_FLUSH_TO_DISK=false` at build (revalidated pages kept in memory so the release folder stays read-only).
- Rehearsed (arm64 only) in an Ubuntu 24.04 container with systemd: install from scratch, upgrade, browser walk with the production Origin
  (11/11 steps; a price edit shows on the site within 1–2 s), Cloudflare-style headers (relative redirects, rate limits on `cf-connecting-ip`),
  `systemd-analyze security` 1.4 OK, reboot, backup + restore drill. Found and fixed: PostgreSQL not started after apt in some setups;
  symlinking `.next` breaks Next's module resolution (replaced by the build flag); checksum file had an absolute path.
- NOT done yet: running it on the real host (only reachable from the office network), DNS record, off-site copy of our backups.

## Verification honesty
- **Everything MoySklad-related is verified against `apps/mock-moysklad`, a synthetic server built from the vendor docs.** It is not a recording of a real account.
  The two behaviours the docs leave open (input timezone of `updated`/`changedSince`; whether archived products are listed by default) are
  switches in the mock and settings in the app. `pnpm probe` (read-only) resolves them against the real account.
- Telegram initData validation is verified against vectors generated with Telegram's documented algorithm, not against a live bot.
- Nothing has been run on a real MoySklad account, a real Telegram bot, or a public domain yet.

## Slices
| # | Slice | State | Notes |
|---|---|---|---|
| 0 | Toolchain; Phase 2 gate | ✅ | The Phase 2 commit was NOT green (typecheck error, no UI tests). Fixed; 9 UI tests. Stepper supports fractional steps (weight goods). |
| 1 | `packages/db` schema + migrations | ✅ | 24 tables, pg_trgm index, advisory-locked migrator |
| 2 | `packages/shared` utilities | ✅ | search skeleton (Cyrillic ↔ Latin), slugs, phone, settings schema, DTOs, uz/ru catalogs |
| 3 | `packages/moysklad` client + `apps/mock-moysklad` | 🟡 | 15 unit + 24 contract tests (429/5xx/lost response/breaker/timezone switch). Synthetic fixtures, not real recordings. |
| 4 | `packages/core` + `apps/api` + `apps/worker` | 🟡 | 70 core + 32 API integration tests on real Postgres/Redis vs the synthetic MoySklad. Live stack boot verified: full sync, images, 8 webhooks registered, 0 × 429 with the enforced limit, **webhook → order status round trip verified live**. |
| 5 | Site | 🟡 | Home, catalogue (filters in URL, sort, grid/list, pagination), category/brand pages, product (JSON-LD), cart, checkout, order status page, static pages, sitemap/robots, revalidate hook. Hand-checked at 390 px; `next build` OK. |
| 6 | Mini App `/tma` | 🟡 | Official telegram-web-app.js; auth via initData (dev stand-in only with TMA_DEV_MODE); tabs, catalogue with infinite scroll, product, favourites, cart (server-synced), checkout, orders, profile, uz/ru, dark theme tokens, MainButton/BackButton/haptics wired. Smoke test drives it with the dev stand-in user (order placed as a T-number). NOT run inside a real Telegram client. |
| 7 | Checkout + order push | ✅ (vs mock) | Idempotency, lost response, counterparty + reserve policies tested; UI works on site and Mini App. |
| 8 | Admin `/admin` (Russian) | ✅ (vs mock) | Login (+TOTP), overview, orders (+write-through status), products (hide only), sync (manual runs, journal), settings (pickers from live MoySklad lists), content/banners/category names, featured slots, Telegram setup, audit/notification logs. Clicked through by the smoke test (login, orders, status write-through, all pages load). |
| 9 | Hardening / e2e / perf | 🟡 | Security tests in place (CSRF, lockout, rate limits, SQL/LIKE injection, initData forgery, webhook forgery, path traversal, bundle secret scan). **`scripts/smoke.mjs` passes 32/32 against the Docker stack** (site → order → MoySklad once → status flows back → admin write-through → Mini App order → no horizontal scroll at 375/768/1440 → axe: no serious/critical; minor: region, heading-order). Load test / Lighthouse NOT done. |
| 10 | Test-server bundle | ✅ (built and run here) | `deploy/Dockerfile` (api/worker/web/mock), `deploy/docker-compose.yml` (profiles demo/tunnel/caddy), `deploy/setup.sh`, backup + restore-drill scripts, CI workflow, `docs/DEPLOY.md`. All four images build; the compose stack (demo profile) came up healthy on this machine; the first full sync ran by itself. The Cloudflare `tunnel` and `caddy` profiles were NOT exercised (no public network/domain here). |

## Next steps, in order
0. Owner fills the catalogue by hand (/admin → Категории, Товары). If MoySklad comes later: decide whether manual products should be
   replaced by / linked to MoySklad products (by article or barcode) — today they simply coexist.
1. Test inside a real Telegram client once the bot exists (MainButton, BackButton, theme, initData signature variants).
2. Load test the catalogue API; Lighthouse on home/catalogue/product; exercise the `tunnel` and `caddy` profiles on a real server.
3. Client answers still needed: two shops = one MoySklad organisation/warehouse or two (order splitting), weighed goods, hosting location/data law, fiscal receipts, payments, delivery rules.

## What was verified where
- `pnpm typecheck`, `pnpm lint` (0 problems), `pnpm test` (183 tests: 20 shared, 15 moysklad, 9 ui, 24 contract, 81 core, 34 api) all green on this machine (2026-11-13).
- `next build` OK; `scripts/check-bundle-secrets.mjs`: no server-only strings in the browser bundle.
- Docker: images built from `deploy/Dockerfile` (Alpine, node 22); `docker compose ... up` with profile `demo`; `scripts/smoke.mjs` 32/32.
- NOT verified anywhere: a real MoySklad account, a real Telegram client/bot, a public domain/HTTPS, Cloudflare tunnel, Caddy, Turnstile, load/Lighthouse.

## Bugs the tests/boot found (fixed; recorded so they stay fixed)
- Phase 2 commit was not green (typecheck error, no UI tests).
- Search skeleton collapsed repeated digits ("851500" → "85150"): collapse is now letters only.
- BullMQ job ids may not contain ":"; dedup ids must also be removed on completion or the next trigger is silently ignored.
- Redis limiter/breaker used `pid`-based member ids: containers share pids, ZADD de-duplicates, the budget under-counted. Now random UUIDs.
- First-boot race: products synced before folders lost their category forever. Folders are now refreshed when a product points at an unknown folder; auto-configuration runs before the first scheduled sync.
- Image downloads (minutes) blocked stock/product sync in a single queue: images have their own queue/worker.
- MEDIA_DIR relative → api and worker used different folders (broken images). Now warned; `.env` uses an absolute path.
- Smoke test found: Mini App test clicked the sr-only radio at screen coordinates and hit the fixed tab bar (test fix); a remembered phone is prefilled by design.
- Cart/checkout grids overflowed at 390 px; checkout page passed a function to a client component.
- MoySklad webhook URL carries `/api/`; a base URL pointing straight at the API 404ed. The API now answers both.
- `autoConfigure` did not detect the "old price" type, so the offers rail stayed empty.

## Deliberately deferred (decided; each needs a client answer or is out of scope for v1)
- **Product variants (MoySklad "modifications").** Schema has room; sync ignores them. Needs: does the client use them?
- **Click / Payme / Uzum payments.** v1 = cash / transfer on delivery or pickup.
- **SMS one-time-password login.** v1 = guest checkout and Telegram identity.
- **Live Cloudflare Turnstile.** Wired and config-ready (`TURNSTILE_SECRET`/site key); off until keys exist. Honeypot, rate limits and per-phone caps are always on.
- **Splitting one basket into two MoySklad orders** (stationery shop vs grocery shop) if they turn out to be separate legal entities/warehouses. Order push reads organisation/store from settings; splitting is not built.
