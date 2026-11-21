#!/usr/bin/env bash
# Builds a self-contained release for a plain Ubuntu host (no Docker on the host): glibc artifacts built in a Debian container,
# with the Node binary bundled, so the server needs no Node install.
#
#   deploy/server/build-release.sh amd64|arm64 [API_PORT]
#
# Output: deploy/server/out/biznimarket-<commit>-<arch>.tar.gz containing
#   bin/node  api/  worker/  web/  VERSION
# Built from the committed tree (git archive HEAD), so a release always matches a commit.
# The API port is baked into the web build (Next rewrites /api/* to it), so it must match API_PORT in /etc/biznimarket/app.env.
set -euo pipefail
cd "$(dirname "$0")/../.."
ARCH="${1:?usage: build-release.sh amd64|arm64 [API_PORT]}"
API_PORT="${2:-4101}"
case "$ARCH" in amd64|arm64) ;; *) echo "arch must be amd64 or arm64" >&2; exit 2 ;; esac
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "Commit your changes first: the release is built from HEAD." >&2
  exit 2
fi
COMMIT="$(git rev-parse --short HEAD)"
NAME="biznimarket-${COMMIT}-${ARCH}"
OUT="$PWD/deploy/server/out"
mkdir -p "$OUT"
SRC="$(mktemp -d)"
trap 'rm -rf "$SRC"' EXIT
git archive --format=tar HEAD | tar -x -C "$SRC"

docker run --rm --platform "linux/${ARCH}" \
  -v "$SRC:/src:ro" -v "$OUT:/out" -v "biznimarket-pnpm-store-${ARCH}:/pnpm-store" \
  -e API_PORT="$API_PORT" -e NAME="$NAME" -e COMMIT="$COMMIT" \
  node:22-bookworm bash -euo pipefail -c '
    export CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
    corepack enable >/dev/null
    cp -a /src /repo && cd /repo
    pnpm config set store-dir /pnpm-store >/dev/null
    pnpm install --frozen-lockfile
    export API_INTERNAL_URL="http://127.0.0.1:${API_PORT}"
    # The release folder is read-only on the host: keep revalidated pages in memory, never write next to the build.
    export NEXT_ISR_FLUSH_TO_DISK=false
    pnpm --filter @shop/api build
    pnpm --filter @shop/worker build
    pnpm --filter @shop/web build
    pnpm --filter @shop/api deploy --legacy --prod /stage/api
    pnpm --filter @shop/worker deploy --legacy --prod /stage/worker
    R=/stage/rel && mkdir -p $R/bin $R/api $R/worker $R/web
    cp /usr/local/bin/node $R/bin/node
    for s in api worker; do
      cp -a /stage/$s/node_modules $R/$s/node_modules
      cp -a /repo/apps/$s/dist $R/$s/dist
      cp -a /repo/packages/db/drizzle $R/$s/drizzle
    done
    cp -a /repo/apps/web/.next/standalone/. $R/web/
    cp -a /repo/apps/web/.next/static $R/web/apps/web/.next/static
    printf "commit=%s\narch=%s\napi_port=%s\nnode=%s\nbuilt=%s\n" "$COMMIT" "$(uname -m)" "$API_PORT" "$(node -v)" "$(date -u +%FT%TZ)" > $R/VERSION
    tar -C $R -czf /out/$NAME.tar.gz .
    echo "built /out/$NAME.tar.gz"
  '
ls -lh "$OUT/$NAME.tar.gz"
(cd "$OUT" && shasum -a 256 "$NAME.tar.gz") | tee "$OUT/$NAME.tar.gz.sha256"
