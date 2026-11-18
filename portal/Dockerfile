# ---------------------------------------------------------------------------
# The portal as one container: API and browser app served from a single origin.
#
# One origin matters beyond tidiness — the session cookie is HttpOnly and
# SameSite=Lax, so serving the app from a different host than the API means
# configuring CORS and cookie domains for no benefit.
#
# Two stages: the first has the toolchain, the second only what runs. The
# native SQLite binding is installed in the runtime stage against the same
# base image, so it matches the platform it will actually execute on.
# ---------------------------------------------------------------------------

# --- build ----------------------------------------------------------------
FROM node:22-bookworm-slim AS build
WORKDIR /app

# Copy manifests first so `npm ci` is cached until a dependency actually
# changes, rather than on every source edit.
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci

COPY . .
RUN npm run build

# --- runtime --------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY web/package.json web/
# Production dependencies only. --ignore-scripts is deliberately NOT used:
# better-sqlite3 needs its install script to place the prebuilt binding.
RUN npm ci --omit=dev --workspace=server --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/shared/dist ./shared/dist
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/web/dist ./web/dist
# Not TypeScript, so tsc never emits it; the server reads it to create tables.
COPY server/src/db/schema.sql ./server/dist/db/schema.sql

# The database lives on a mounted volume, owned by the unprivileged user the
# process runs as.
RUN mkdir -p /data && chown -R node:node /data /app
USER node

ENV DATABASE_PATH=/data/portal.db \
    WEB_DIST_PATH=/app/web/dist \
    PORT=4000
EXPOSE 4000

# Liveness only — a database fault should not send the container into a
# restart loop when restarting is not the fix. /api/ready reports that.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

WORKDIR /app/server
CMD ["node", "dist/index.js"]
