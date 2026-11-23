# Kanso — notes for Claude (read first)

The owner writes in **Uzbek (Latin)**; reply in Uzbek. Keep code, file names and UI strings as they are.
The shop was first built as "Bizni Market"; internal names (`biznimarket` user/services/paths, `@shop/*` packages) keep that name.

## What is live (state 2026-11-23)
- **https://kanso.uz** (+ `www`): the shop — computers, computer services and stationery. Site `/uz` `/ru`, admin `/admin`,
  Telegram Mini App `/tma`, bot **@kansomarketbot**. No MoySklad: catalogue and orders are handled in `/admin`.
- Runs on the **office Ubuntu server** ("crm-server", user `vocora`, x86_64), shared with a client's **CRM** (crm.vocora.uz, port 4000)
  and a clinic site **tishcha.uz** (port 4200, separate repo). Everything goes out through **one Cloudflare Tunnel**
  `347b9120-069d-4c16-88d2-469c60a4bd1c`; nothing listens beyond 127.0.0.1. Domains are in the Cloudflare account that holds vocora.uz.
- Our services: `biznimarket-api` (127.0.0.1:4101), `biznimarket-web` (127.0.0.1:4100), `biznimarket-worker`, `biznimarket-backup.timer`;
  PostgreSQL 16 + Redis on loopback; settings `/etc/biznimarket/app.env` (root:biznimarket 0640, never print it);
  releases `/srv/biznimarket/releases/*`, current = symlink `/srv/biznimarket/app`; backups `/srv/biznimarket/backups` (daily).
- Tunnel rules in `/etc/cloudflared/config.yml` (service `cloudflared-tunnel`): kanso.uz, www.kanso.uz → 127.0.0.1:4100.

## Server access
- Only from the **office network**. The server's IP comes from DHCP and changes (was .15, then .18; nobody can log into the router).
  `deploy/server/find-office-server.sh` finds it by MAC `f4:b5:20:56:35:ef`. Suggested `~/.ssh/config`:
  ```
  Host crm-server
    HostName office-server
    User vocora
    ProxyCommand nc $(~/path/to/find-office-server.sh) %p
  ```
  The new computer's SSH public key must be added to `~vocora/.ssh/authorized_keys` on the server first (from a computer that has access).
- At home another device answers on 192.168.1.x (port 22 refused): do not retry, tell the owner.

## Rules on the shared server (from its owner)
Never touch the CRM (user `crm`, `/srv/crm`, `/etc/crm`, `crm.service`, port 4000, its backup, its hostname in `config.yml`) or tishcha.
No public ports, no ufw/SSH/router changes. Before editing `config.yml`: back it up, add rules before the final `http_status:404`,
`cloudflared tunnel ingress validate`, restart, then check `https://crm.vocora.uz/api/health` still answers. Secrets never in chat:
the owner types tokens/passwords themselves (e.g. `deploy/server/set-telegram.sh`). Ask before any change on the server.

## Deploy a change
1. `pnpm typecheck && pnpm lint` (+ `pnpm --filter @shop/shared --filter @shop/ui test`; the other tests need Postgres/Redis via Docker).
2. Commit, then in the office: `deploy/server/deploy-from-mac.sh` — builds on the server, backs up, installs, prints ALL OK + public checks.
3. `git push origin main`.
Bot texts changed? Admin → Tizim → "Botni sozlash" re-applies descriptions/menu button.

## What the owner can change in /admin (so it is not hard-coded)
Shop name, home title/text, bot welcome/descriptions, contacts, pages (Sayt matnlari); categories with their own pictures
(Kategoriyalar; without one: product photos, then a default icon picture); products (edit/delete per row, bulk delete,
"delete all products"); banners; admin password (Tizim → Xavfsizlik).

More: `docs/DEPLOY-SERVER.md` (server install/rollback), `docs/ARCHITECTURE.md`, `docs/STATUS.md` (older build log).
