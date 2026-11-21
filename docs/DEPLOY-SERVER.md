# Bizni Market on the office server (crm-server)

The office Ubuntu 24.04 host also runs the client's CRM. This deployment is built for that: **no Docker, nothing listens beyond
127.0.0.1, the site goes out through the existing Cloudflare Tunnel, the CRM is never touched.** Rules come from the server owner;
they are summarised at the end. The Docker route (`docs/DEPLOY.md`) is for a dedicated machine and is not used here.

Rehearsed end to end on 2026-11-14 in an Ubuntu 24.04 container with real systemd: install, sandboxed services, browser walk
(admin login, category, product with photo, price edit visible on the site within a second or two, guest order, status change, stock),
reboot (everything comes back), upgrade to a newer release, backup and a restore drill. With Cloudflare-style headers
(`Host`, `X-Forwarded-Proto: https`, `Cf-Connecting-Ip`): redirects stay relative and rate limits key on the visitor address.
Only the arm64 build has run; the amd64 build has not run anywhere yet, so step 5 below is mandatory before step 6.
Not yet run on the real host.

## What gets installed

| What | Where | Notes |
|---|---|---|
| System user `biznimarket` | no login shell | runs all three services |
| Releases | `/srv/biznimarket/releases/<name>/` (root-owned, read-only) | `bin/node` (bundled Node 22), `api/`, `worker/`, `web/` |
| Current release | `/srv/biznimarket/app` → symlink | switched atomically; the three newest releases are kept |
| Data | `/srv/biznimarket/data/media` (biznimarket, 0750) | the only folder the services may write |
| Backups | `/srv/biznimarket/backups` (root, 0700) | daily 03:40, 14 days: `db-*.dump`, `media-*.tar.gz` |
| Settings | `/etc/biznimarket/app.env` (root:biznimarket 0640) | generated with random secrets, never printed |
| First admin password | `/etc/biznimarket/admin-initial-password` (root 0600) | the owner reads it, changes it, deletes the file |
| Services | `biznimarket-api` (127.0.0.1:4101), `biznimarket-web` (127.0.0.1:4100), `biznimarket-worker`, `biznimarket-backup.timer` | sandboxed; `systemd-analyze security` = 1.4 OK |
| PostgreSQL 16, Redis 7 | Ubuntu packages, loopback only | own role/database `biznimarket`; Redis gets a password, `noeviction`, `appendonly` |
| Tunnel rule | `/etc/cloudflared/config.yml` | one `hostname → http://127.0.0.1:4100` rule before the catch-all |

## On the day (in the office, from this Mac)

0. **Before anything:** `curl -s https://crm.vocora.uz/api/health` shows `"backup":true` for today. Owner has approved
   `apt install postgresql redis-server`. Domain decided (default `biznimarket.vocora.uz`).
1. **Look, change nothing:**
   ```bash
   ssh crm-server 'uname -m; free -m; df -h /; ss -ltn; systemctl is-active crm cloudflared; dpkg -s postgresql redis-server 2>&1 | grep -E "^Package|^Status|not installed"; grep -E "hostname|service" /etc/cloudflared/config.yml'
   ```
   `uname -m` picks the release: `x86_64` → `amd64`, `aarch64` → `arm64`. Ports 4100/4101 must be free.
   If Redis or PostgreSQL is already installed, stop and talk to the owner (install.sh refuses to change a Redis it did not install).
2. **Copy** (release built on the Mac with `deploy/server/build-release.sh <arch>`; it is built from a commit):
   ```bash
   scp deploy/server/out/biznimarket-<commit>-<arch>.tar.gz{,.sha256} crm-server:/tmp/
   scp -r deploy/server crm-server:/tmp/biznimarket-deploy
   ```
3. **Databases + settings:** `ssh -t crm-server sudo /tmp/biznimarket-deploy/install.sh stores --domain biznimarket.vocora.uz`
4. **App:** `ssh -t crm-server sudo /tmp/biznimarket-deploy/install.sh release /tmp/biznimarket-<commit>-<arch>.tar.gz`
   It ends with `ALL OK` (services active, API ready, site answers, nothing of ours beyond loopback).
5. **Try it before it is public:** `ssh -N -L 3300:127.0.0.1:4100 crm-server`, open `http://localhost:3300/uz` on the Mac.
6. **Tunnel rule:** `sudo /tmp/biznimarket-deploy/cloudflared-route.sh biznimarket.vocora.uz` shows the diff (dry run);
   with `--apply` it backs up `config.yml`, inserts the rule before `http_status:404`, runs `ingress validate` (restores the
   backup if it fails), restarts cloudflared and re-checks the CRM.
7. **DNS** (owner, Cloudflare panel, zone vocora.uz): CNAME `biznimarket` → `347b9120-069d-4c16-88d2-469c60a4bd1c.cfargotunnel.com`,
   Proxied. (Alternative: `cloudflared tunnel login` + `cloudflared tunnel route dns`, then delete `cert.pem`.)
8. **Admin password:** the owner runs `sudo cat /etc/biznimarket/admin-initial-password` in their own terminal, signs in at
   `https://<domain>/admin`, changes it in **Tizim**, then `sudo rm /etc/biznimarket/admin-initial-password`.
   (install.sh already blanked the plain password in `app.env` once the admin existed.)
9. **Check:** `https://<domain>/uz` opens; `https://crm.vocora.uz/api/health` still 200; place a test order and see the visitor's
   real address (not 127.0.0.1) in `journalctl -u biznimarket-api | grep orders`; `sudo /tmp/biznimarket-deploy/install.sh check`.

## Later

- **Update:** build a new release on the Mac, `scp` it, `sudo install.sh release <tarball>` (migrations run on start).
  Without Docker: build on the server itself (unprivileged, low priority, Node fetched from nodejs.org and checksum-verified):
  `git archive --format=tar HEAD > src.tar && scp src.tar deploy/server/build-on-host.sh crm-server:/tmp/` then
  `ssh crm-server 'COMMIT=<sha> bash /tmp/build-on-host.sh /tmp/src.tar 4101'` → `~/biznimarket-releases/…tar.gz` → `install.sh release`.
- **Roll back the app:** `sudo ln -sfn /srv/biznimarket/releases/<previous> /srv/biznimarket/app && sudo systemctl restart biznimarket-api biznimarket-worker biznimarket-web`.
  A release whose migrations changed the database needs the matching backup (see `deploy/server/backup.sh`).
- **Take the site offline:** restore the `config.yml.bak-*` that `cloudflared-route.sh` printed and restart cloudflared; or
  `sudo systemctl disable --now biznimarket-web`.
- **Remove completely:** disable + delete the five units, `dropdb biznimarket; dropuser biznimarket` (as postgres), remove the
  `# >>> biznimarket` block from `/etc/redis/redis.conf`, delete `/srv/biznimarket`, `/etc/biznimarket`, `userdel biznimarket`;
  `apt remove postgresql redis-server` only if nothing else uses them.
- **Logs:** `journalctl -u biznimarket-api -u biznimarket-worker -u biznimarket-web -f`.
- **Off-site backup:** not set up. The CRM's off-site backup does not include this app. Decide with the owner where copies of
  `/srv/biznimarket/backups` should go.
- **Telegram bot / MoySklad later:** set `TELEGRAM_BOT_TOKEN`/`TELEGRAM_BOT_USERNAME` or `MOYSKLAD_TOKEN` in `app.env`, restart the three
  services. Both use outbound 443 only (allowed). No rebuild.

## Host rules this follows (from the server owner, 2026-11-14)
No public ports, no router/ufw/SSH changes; outbound only 53, 123, 80, 443, 7844. Do not touch the CRM (user `crm`, `/srv/crm`,
`/etc/crm`, `crm.service`, port 4000, its backup, its hostname in `config.yml`). Back up `config.yml` before editing, add our rule
before the catch-all, validate before restart, check `crm.vocora.uz` afterwards. Secrets never in chat. Demo mode off.
The passwordless sudo for `vocora` is temporary and only for these steps.
