# Deploying the test server (and, later, production)

Everything runs from one Docker Compose file: `deploy/docker-compose.yml` (postgres, redis, api, worker, web; optional mock MoySklad, Cloudflare tunnel, Caddy).

## Requirements
- A Linux VM (or any machine) with Docker + Compose, **>= 2 GB RAM** (the first `docker compose build` runs `next build`; on 1 GB add swap or build the images elsewhere).
- Free options for a client test server: Oracle Cloud "Always Free" VM (best fit, needs a card for verification), any small VPS, or a spare computer. Nothing in the stack depends on the host.
- **Data location:** customers' names, phones and addresses are personal data. Uzbekistan's personal-data law is understood to require citizens' data to be stored on servers inside Uzbekistan. A demo with synthetic data is fine anywhere; for the real shop, confirm with a lawyer/accountant before choosing the host.

## 1. Test server with the synthetic MoySklad (no token, no bot, no domain)
```bash
git clone <repo> shop && cd shop
./deploy/setup.sh demo                      # writes deploy/.env with random secrets, prints the admin password once
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up -d --build
docker compose --env-file deploy/.env -f deploy/docker-compose.yml logs cloudflared | grep trycloudflare.com   # the public https URL
```
- Open `<that URL>/uz` (site), `/tma` (Mini App in a plain browser, demo user), `/admin` (login from setup.sh).
- On first boot the worker runs a full sync from the mock automatically (about 200 products; photos fill in behind it over a few minutes).
- Mock control page (price / stock / order status "in MoySklad"): `http://127.0.0.1:4010/__mock` on the server (SSH tunnel: `ssh -L 4010:127.0.0.1:4010 server`).
- The quick-tunnel URL **changes on every restart**. Set `PUBLIC_URL` in `deploy/.env` to the current URL and `docker compose ... up -d` again so sitemap/metadata use it. It is for demos only.
- The demo shows a "Demo rejim" banner on every page while the source is not the real MoySklad cloud.

## 1b. Real shop without MoySklad (manual catalogue)
`./deploy/setup.sh` (not `demo`) leaves `MOYSKLAD_TOKEN` empty. That is a complete shop, not a demo:
- /admin -> **Категории**: create categories (name in uz and ru, nesting, order). /admin -> **Товары** -> "Добавить товар": name, price, old price,
  stock, unit, brand, photos (several at once, from a phone camera too). The site and the Mini App show them immediately.
- Every photo is stored as a 1:1 square on white with an even margin (WebP 160/400/1000 px), whatever its shape or format; big phone photos
  are downsized in the browser before upload; iPhone HEIC is converted by Safari. Nothing is stretched or cropped.
- Orders are handled in /admin -> **Заказы** (Новый -> Подтверждён -> Доставляется / Готов к выдаче -> Выполнен, or Отменён). Placing an
  order takes the units from stock; cancelling gives them back. The customer sees the status in their language (and in Telegram).
- **Back up the photo folder** (`deploy/backup.sh` does it): uploaded photos exist only on this server.
- Adding MoySklad later (step 2.1) does not touch manual products or categories; MoySklad products appear next to them, read-only.
  Orders that contain a manual product stay in /admin (MoySklad does not know that product).

## 2. Going real: the three inputs
1. **MoySklad token** -> `MOYSKLAD_TOKEN`, `MOYSKLAD_BASE_URL=https://api.moysklad.ru/api/remap/1.2`, remove the `demo` profile and `MOYSKLAD_WEBHOOK_BASE_URL`. Run `pnpm probe` first (read-only). Then /admin -> Настройки: pick price type, warehouses, organisation, initial order state; /admin -> Синхронизация -> "Полная синхронизация".
2. **Bot** -> `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`; then `pnpm telegram:setup` (or /admin -> Система -> "Настроить бота"). Set `TMA_DEV_MODE=false` (the server refuses to start with it on + a real token in production).
3. **Domain** -> point DNS at the server, set `DOMAIN`, `PUBLIC_URL=https://<domain>`, `COMPOSE_PROFILES=caddy`; `docker compose ... up -d`. Caddy gets the certificate automatically. Drop the `tunnel` profile.

No rebuild is needed for any of the three: they are runtime environment variables (the only build-time value is the internal `api` service address).

## Operations
- **Logs:** `docker compose ... logs -f api worker`. **Health:** `GET /api/ready` through the web port, admin dashboard shows sync/queue/webhook state.
- **Backup:** `deploy/backup.sh` (pg_dump of the database + a tar of the photo folder; uploaded photos cannot be re-downloaded). **Restore drill:** `deploy/restore-check.sh <dump>` restores the database into a throw-away container and counts rows; photos restore with `docker compose --env-file .env -f docker-compose.yml exec -T api tar -xzf - -C /data < backups/media-<date>.tar.gz`.
- **MoySklad blocked us?** The breaker pauses background calls after ~20 failures/minute (MoySklad's cut-off is 200). /admin -> Обзор shows it and has a reset button. Only MoySklad support can lift a real API ban.
- **Stuck orders (MoySklad):** /admin -> Заказы, filter "С ошибкой"; open the order -> "Повторить отправку" (duplicate-safe: it looks the order up by its syncId first). Orders handled in the admin ("Ведутся здесь") are never sent.
- **Upgrade:** `git pull && docker compose ... up -d --build` (migrations run on boot under an advisory lock).
- **Security notes:** secrets only in `deploy/.env` (chmod 600). The web app never sees MoySklad credentials; CI fails the build if a server-only string reaches the browser bundle.
