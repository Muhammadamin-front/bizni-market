# Kanso — notes for Claude (read first)

The owner writes in **Uzbek (Latin)**; reply in Uzbek. Keep code, file names and UI strings as they are.
The shop was first built as "Bizni Market"; internal names (`biznimarket` user/services/paths, `@shop/*` packages) keep that name.

## What is live (state 2026-11-24)
- **https://kanso.uz** (+ `www` → 301 to the apex): the shop — computers, computer services and stationery. Site `/uz` `/ru`, admin `/admin`,
  Telegram Mini App `/tma` (bot menu button "Do‘kon / Магазин"), bot **@kansomarketbot**. No MoySklad: catalogue and orders are handled in `/admin`.
- Runs on the **Contabo VPS** `173.249.4.209` (Ubuntu 24.04, x86_64; `ssh root@173.249.4.209`, key-based), moved there from the office
  server on 2026-11-24. The VPS is shared with other projects: **taklifnoma** (Docker; its `taklifnoma-caddy` owns ports 80/443 for every
  site), **sms-forwarder** (systemd, sms.meethub.uz) and **telegram-ads-bot** (Docker). Never stop or restart them.
- Owner's limit for Kanso: **3 GB RAM and 35 GB disk** in total.
  - RAM: `/etc/systemd/system/kanso.slice` (MemoryMax=3G). Our units, PostgreSQL and Redis run in it via drop-ins `<unit>.d/50-kanso.conf`.
  - Disk: sparse image `/srv/kanso.img` (35G ext4) mounted at `/srv/kanso-vol`; bind mounts put `/srv/biznimarket`, `/var/lib/postgresql`,
    `/var/lib/redis` on it (`/etc/fstab`). PostgreSQL and Redis serve only Kanso.
- Our services: `biznimarket-api` (127.0.0.1:4101), `biznimarket-web` (**172.19.0.1:4100**, the gateway of Docker network
  `taklifnoma_default`, so Caddy in Docker can reach it; set in the web drop-in), `biznimarket-worker`, `biznimarket-backup.timer`.
  The api/worker/backup drop-ins pull in `postgresql@16-main` directly (the umbrella `postgresql.service` can be "active" without it).
- Settings `/etc/biznimarket/app.env` (root:biznimarket 0640, never print it). Contabo-specific values: `WEB_REVALIDATE_URL` on 172.19.0.1,
  `CLIENT_IP_HEADER=x-real-ip` (Caddy sets it), `TZ=Asia/Tashkent` (the VPS clock is Europe/Berlin).
- Releases `/srv/biznimarket/releases/*`, current = symlink `/srv/biznimarket/app`; backups `/srv/biznimarket/backups` (daily).
- HTTPS: blocks `kanso.uz` / `www.kanso.uz` in the shared `/opt/taklifnoma/Caddyfile` (`header_up X-Real-IP {remote_host}`).
  DNS: Cloudflare zone, A records → 173.249.4.209, **DNS only** (grey cloud). If the proxy is ever turned on, the client-IP setup must change.
- The Telegram webhook is set with `ip_address=173.249.4.209`; if the server IP changes, set the webhook again with the new address.

## Rules on the shared VPS
- Caddyfile is a single-file bind mount: back it up, **append** (`cat >>`, never `sed -i` or an editor that replaces the file), then
  `docker exec taklifnoma-caddy caddy validate --config /etc/caddy/Caddyfile` and `... caddy reload ...`. Never restart the container.
- Do not touch the other projects' files, containers or units; no firewall/SSH changes. Secrets never in chat.
- The old office server ("crm-server", shared with a client's CRM) may still hold a stopped copy of Kanso; never touch its CRM.

## Deploy a change
1. `pnpm typecheck && pnpm lint` and the tests (`pnpm stores:up` for Postgres/Redis in Docker, then `pnpm --filter @shop/shared --filter @shop/core --filter @shop/api test`).
2. Commit, then `deploy/server/deploy-from-mac.sh`: builds on the VPS as user `kansobuild` inside kanso.slice (files on the Kanso volume),
   backs up, installs, prints ALL OK + public checks. Rollback: point `/srv/biznimarket/app` at the previous release and restart the three units.
3. `git push origin main`.
Bot texts changed? Admin → Tizim → "Botni sozlash" re-applies descriptions/menu button.

## What the owner can change in /admin (so it is not hard-coded)
Shop name, home title/text, bot welcome/descriptions, contacts, pages (Sayt matnlari); categories with their own pictures
(Kategoriyalar; without one: product photos, then a default icon picture); products (edit/delete per row, bulk delete,
"delete all products"; name and description in Uzbek (required, the slug comes from it) and Russian (optional, columns
`name_ru`/`description_ru`; empty = /ru shows the Uzbek text; order lines and stats keep the Uzbek name)); orders: cancelled ones can be deleted for good (per order, or all cancelled at once); banners;
admin password (Tizim → Xavfsizlik).
Whole-site control: Barcha matnlar (`/admin/texts`: every plain UI text of the site and the Mini App, stored as content blocks `t.<path>`),
Sayt dizayni (`/admin/site`: logo, accent/background colours `theme.*`, show/hide home sections `home.show.*`), Statistika (`/admin/stats`).
All of it is content blocks (no migration); the Mini App reads the same blocks from `/api/v1/config`.

More: `docs/DEPLOY-SERVER.md` (first install, written for the office server), `docs/ARCHITECTURE.md`, `docs/STATUS.md` (older build log).
