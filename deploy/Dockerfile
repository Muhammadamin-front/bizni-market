# Alpine (musl) base; sharp ships musl binaries. Override with --build-arg NODE_IMAGE=node:24-slim if you prefer Debian.
# One Dockerfile, four runtime targets: api, worker, web, mock. Build context = repo root.
#   docker build -f deploy/Dockerfile --target api -t shop-api .
ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=1
RUN corepack enable && apk add --no-cache ca-certificates openssl libc6-compat
WORKDIR /repo

# ---- build everything once --------------------------------------------------------------------------------------------
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# The web app bakes its rewrite target (/api/* -> the api service) at build time; the compose service name is fixed.
ARG API_INTERNAL_URL=http://api:4000
ENV API_INTERNAL_URL=$API_INTERNAL_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @shop/api build && pnpm --filter @shop/worker build && pnpm --filter @shop/mock-moysklad build && pnpm --filter @shop/web build
# Production-only node_modules per service (workspace packages are bundled into dist, third-party deps stay external).
RUN pnpm --filter @shop/api deploy --legacy --prod /out/api && pnpm --filter @shop/worker deploy --legacy --prod /out/worker && pnpm --filter @shop/mock-moysklad deploy --legacy --prod /out/mock

# ---- api ---------------------------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS api
ENV NODE_ENV=production
RUN apk add --no-cache ca-certificates libc6-compat
WORKDIR /app
COPY --from=build /out/api/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/packages/db/drizzle ./drizzle
RUN mkdir -p /data/media && chown -R node:node /data /app
USER node
EXPOSE 4000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=5 CMD node -e "fetch('http://127.0.0.1:4000/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]

# ---- worker ------------------------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS worker
ENV NODE_ENV=production
RUN apk add --no-cache ca-certificates libc6-compat
WORKDIR /app
COPY --from=build /out/worker/node_modules ./node_modules
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/packages/db/drizzle ./drizzle
RUN mkdir -p /data/media && chown -R node:node /data /app
USER node
CMD ["node", "dist/main.js"]

# ---- web (Next standalone) ---------------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=5 CMD node -e "fetch('http://127.0.0.1:3000/robots.txt').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ---- synthetic MoySklad (demo only) -------------------------------------------------------------------------------------
FROM ${NODE_IMAGE} AS mock
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /out/mock/node_modules ./node_modules
COPY --from=build /repo/apps/mock-moysklad/dist ./dist
USER node
EXPOSE 4010
CMD ["node", "dist/main.js"]
