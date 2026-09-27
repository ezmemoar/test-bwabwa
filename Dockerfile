# syntax=docker/dockerfile:1
# Multi-stage build: the runtime image holds only Nitro's self-contained .output (no node_modules, no sources).
# Migrations are not run on boot; apply them as a release step: `pnpm db:migrate` (prisma migrate deploy).

FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# Scripts run later: `prisma generate` and `nuxt prepare` (postinstall) need the sources; `pnpm build` runs both.
RUN pnpm install --frozen-lockfile --ignore-scripts
COPY . .
RUN pnpm build

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
COPY --from=build --chown=node:node /app/.output ./.output
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", ".output/server/index.mjs"]
