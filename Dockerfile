# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
ENV COREPACK_HOME=/opt/corepack CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY apps/console ./apps/console
COPY tools/analysers ./tools/analysers
COPY deploy ./deploy
RUN pnpm install --frozen-lockfile --filter . --filter @playerone/console... --filter @playerone/api...
RUN pnpm -F @playerone/design build:css && pnpm -F @playerone/console build

# Explicit one-off owner credential job. Never used as the web start command.
FROM build AS migrate
USER node
CMD ["pnpm", "db:migrate"]

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3000 PLAYERONE_SECURE_COOKIES=1
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/api ./packages/api
COPY --from=build --chown=node:node /app/packages/store ./packages/store
COPY --from=build --chown=node:node /app/packages/contracts ./packages/contracts
COPY --from=build --chown=node:node /app/tools/analysers ./tools/analysers
COPY --from=build --chown=node:node /app/apps/console/dist ./apps/console/dist
COPY --from=build --chown=node:node /app/deploy ./deploy
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/showcase.mjs"]
