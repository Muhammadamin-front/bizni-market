#!/usr/bin/env bash
# Ships the committed HEAD to the Contabo VPS and switches the live shop (kanso.uz) to it. Run from the repo root.
#
#   deploy/server/deploy-from-mac.sh            (ssh target: root@173.249.4.209; override with HOST=...)
#
# Steps: copy deploy/server and the source to the server; build the release there as the unprivileged user `kansobuild`,
# inside Kanso's own limits (kanso.slice = 3 GB RAM for the whole shop; build files on the 35 GB Kanso volume); back up the
# database and photos; install the release (migrations run on start); print "ALL OK" and public checks.
# Rollback: ln -sfn /srv/biznimarket/releases/<previous> /srv/biznimarket/app && systemctl restart biznimarket-api biznimarket-worker biznimarket-web
set -euo pipefail
cd "$(dirname "$0")/../.."
HOST="${HOST:-root@173.249.4.209}"
B=/srv/kanso-vol/build                      # build home: on the Kanso volume, so builds count toward its 35 GB
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "Commit first: the server gets HEAD." >&2; exit 2; }
C="$(git rev-parse --short HEAD)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
git archive --format=tar HEAD > "$TMP/src.tar"

echo "==> $C -> $HOST"
ssh "$HOST" "set -e; mountpoint -q /srv/kanso-vol || { echo 'Kanso volume /srv/kanso-vol is not mounted' >&2; exit 1; }
  id kansobuild >/dev/null 2>&1 || useradd --system --no-create-home --home-dir $B --shell /usr/sbin/nologin kansobuild
  install -d -o kansobuild -g kansobuild -m 0750 $B $B/tmp
  rm -rf /tmp/biznimarket-deploy"
# The scripts stay root-owned (root runs install.sh from there); the build user only reads them.
scp -q -r deploy/server "$HOST:/tmp/biznimarket-deploy"
scp -q "$TMP/src.tar" "$HOST:$B/src.tar"

echo "==> building on the server inside kanso.slice (a few minutes)"
ssh "$HOST" "set -e; chown kansobuild:kansobuild $B/src.tar
  echo \"slice before: \$((\$(cat /sys/fs/cgroup/kanso.slice/memory.current) / 1048576)) MB, \$(grep oom_kill /sys/fs/cgroup/kanso.slice/memory.events)\"
  systemd-run --quiet --wait --pipe --collect --uid=kansobuild --gid=kansobuild --slice=kanso.slice \
    -p RequiresMountsFor=/srv/kanso-vol -p MemoryMax=1800M -p OOMScoreAdjust=1000 -p Nice=15 -p IOWeight=10 \
    --working-directory=$B -E HOME=$B -E TMPDIR=$B/tmp -E COMMIT=$C \
    bash /tmp/biznimarket-deploy/build-on-host.sh $B/src.tar 4101 > /tmp/bm-build-$C.log 2>&1 \
    || { tail -40 /tmp/bm-build-$C.log; grep oom_kill /sys/fs/cgroup/kanso.slice/memory.events; exit 1; }
  echo \"slice peak: \$((\$(cat /sys/fs/cgroup/kanso.slice/memory.peak) / 1048576)) MB (cap 3072), \$(grep oom_kill /sys/fs/cgroup/kanso.slice/memory.events)\"
  rm -f $B/src.tar
  ls -1t $B/biznimarket-releases/*.tar.gz | tail -n +4 | while read -r old; do rm -f \"\$old\" \"\$old.sha256\"; done"

echo "==> backup + install"
ssh "$HOST" "systemctl start biznimarket-backup.service && bash /tmp/biznimarket-deploy/install.sh release $B/biznimarket-releases/biznimarket-$C-amd64.tar.gz"

echo "==> public check"
for u in https://kanso.uz/uz https://kanso.uz/admin https://kanso.uz/tma https://sms.meethub.uz/api/v1/health; do
  printf '%-34s %s\n' "$u" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$u")"
done
