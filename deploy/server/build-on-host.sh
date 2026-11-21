#!/usr/bin/env bash
# Builds the same release as build-release.sh, but natively on a Linux host (no Docker): run it on the target server itself.
# Unprivileged, works in a temp folder, low CPU priority. Needs outbound 443 (nodejs.org, npm registry).
#
#   ./build-on-host.sh <source.tar> [API_PORT]      source.tar = `git archive --format=tar HEAD` of the repo
# Output: ~/biznimarket-releases/biznimarket-<commit>-<arch>.tar.gz (+ .sha256)
set -euo pipefail
SRC_TAR="${1:?usage: build-on-host.sh <source.tar> [API_PORT]}"
API_PORT="${2:-4101}"
COMMIT="${COMMIT:?set COMMIT (git rev-parse --short HEAD)}"
case "$(uname -m)" in x86_64) ARCH=amd64; NODE_ARCH=x64 ;; aarch64) ARCH=arm64; NODE_ARCH=arm64 ;; *) echo "unsupported arch" >&2; exit 1 ;; esac
NAME="biznimarket-${COMMIT}-${ARCH}"
OUT="$HOME/biznimarket-releases"
CACHE="$HOME/.cache/biznimarket-build"
mkdir -p "$OUT" "$CACHE"
WORK="$(mktemp -d /tmp/bm-build.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

# Node 22 (official build, checksum-verified, cached between builds).
SUMS="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt)"
FILE="$(printf '%s\n' "$SUMS" | awk '{print $2}' | grep -E "^node-v22\.[0-9.]+-linux-${NODE_ARCH}\.tar\.xz$" | head -1)"
if [ ! -f "$CACHE/$FILE" ]; then curl -fsSL "https://nodejs.org/dist/latest-v22.x/$FILE" -o "$CACHE/$FILE.part" && mv "$CACHE/$FILE.part" "$CACHE/$FILE"; fi
(cd "$CACHE" && printf '%s\n' "$SUMS" | grep " $FILE\$" | sha256sum -c --quiet -) || { rm -f "$CACHE/$FILE"; echo "node checksum mismatch" >&2; exit 1; }
tar -xJf "$CACHE/$FILE" -C "$WORK"
NODE_DIR="$WORK/${FILE%.tar.xz}"
export PATH="$NODE_DIR/bin:$WORK/bin:$PATH" CI=1 COREPACK_ENABLE_DOWNLOAD_PROMPT=0 NEXT_TELEMETRY_DISABLED=1
mkdir -p "$WORK/bin" && corepack enable --install-directory "$WORK/bin" >/dev/null

mkdir -p "$WORK/repo" && tar -xf "$SRC_TAR" -C "$WORK/repo" && cd "$WORK/repo"
pnpm config set store-dir "$CACHE/pnpm-store" >/dev/null
nice -n 15 pnpm install --frozen-lockfile
export API_INTERNAL_URL="http://127.0.0.1:${API_PORT}"
# The release folder is read-only on the host: keep revalidated pages in memory, never write next to the build.
export NEXT_ISR_FLUSH_TO_DISK=false
nice -n 15 pnpm --filter @shop/api build
nice -n 15 pnpm --filter @shop/worker build
nice -n 15 pnpm --filter @shop/web build
pnpm --filter @shop/api deploy --legacy --prod "$WORK/stage/api" >/dev/null
pnpm --filter @shop/worker deploy --legacy --prod "$WORK/stage/worker" >/dev/null
R="$WORK/rel" && mkdir -p "$R/bin" "$R/api" "$R/worker" "$R/web"
cp "$NODE_DIR/bin/node" "$R/bin/node"
for s in api worker; do
  cp -a "$WORK/stage/$s/node_modules" "$R/$s/node_modules"
  cp -a "apps/$s/dist" "$R/$s/dist"
  cp -a packages/db/drizzle "$R/$s/drizzle"
done
cp -a apps/web/.next/standalone/. "$R/web/"
cp -a apps/web/.next/static "$R/web/apps/web/.next/static"
printf "commit=%s\narch=%s\napi_port=%s\nnode=%s\nbuilt=%s\n" "$COMMIT" "$(uname -m)" "$API_PORT" "$(node -v)" "$(date -u +%FT%TZ)" > "$R/VERSION"
tar -C "$R" -czf "$OUT/$NAME.tar.gz" .
(cd "$OUT" && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
ls -lh "$OUT/$NAME.tar.gz"
