#!/usr/bin/env bash
# Ships the committed HEAD to the office server and switches the live shop (kanso.uz) to it. Run from the repo root, in the office.
#
#   deploy/server/deploy-from-mac.sh            (ssh host alias: crm-server; override with HOST=user@ip)
#
# Steps: copy deploy/server to the server, build the release there (unprivileged, build-on-host.sh), back up the database
# and photos, install the release (migrations run on start), print "ALL OK". Rollback: see docs/DEPLOY-SERVER.md.
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST="${HOST:-crm-server}"
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Commit first: the server gets HEAD." >&2; exit 2; }
C="$(git rev-parse --short HEAD)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git archive --format=tar HEAD > "$TMP/src.tar"

echo "==> $C -> $HOST"
ssh "$HOST" 'rm -rf /tmp/biznimarket-deploy'
scp -q -r deploy/server "$HOST:/tmp/biznimarket-deploy"
scp -q "$TMP/src.tar" "$HOST:/tmp/src.tar"
echo "==> building on the server (a few minutes)"
ssh "$HOST" "COMMIT=$C bash /tmp/biznimarket-deploy/build-on-host.sh /tmp/src.tar 4101 > /tmp/bm-build-$C.log 2>&1 || { tail -40 /tmp/bm-build-$C.log; exit 1; }"
echo "==> backup + install"
ssh "$HOST" "sudo systemctl start biznimarket-backup.service && sudo /tmp/biznimarket-deploy/install.sh release ~/biznimarket-releases/biznimarket-$C-amd64.tar.gz"
echo "==> public check"
for u in https://kanso.uz/uz https://kanso.uz/admin https://kanso.uz/tma https://crm.vocora.uz/api/health https://tishcha.uz/uz; do
  printf '%-34s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$u")"
done
