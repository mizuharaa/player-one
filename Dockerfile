# syntax=docker/dockerfile:1

# ffmpeg and ffprobe, from the distro, in the one layer both stages inherit.
#
# The API needs them itself, not only the tools: `packages/api/src/risk/media.ts`
# decodes frames and probes the encoder through `tools/analysers`, and the
# ingest engine measures a session's real media span with ffprobe
# (`packages/ingest/src/timing.ts`). `deploy/centre/README.md` installs them by
# hand on the Windows centre PC; a Linux VM gets them here, so no leg of the
# loop depends on what the host happens to have on PATH.
#
# Pinned to bookworm's 5.1 series rather than to one point release. The
# candidate is `7:5.1.9-0+deb12u1` today; a Debian security update to
# `deb12u2` must not fail the build, and a different upstream series must.
FROM node:22-bookworm-slim AS base
RUN apt-get update \
  && apt-get install --yes --no-install-recommends ffmpeg=7:5.1.* \
  && rm -rf /var/lib/apt/lists/*

FROM base AS build
ENV COREPACK_HOME=/opt/corepack CI=true
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages ./packages
COPY apps/console ./apps/console
COPY tools/analysers ./tools/analysers
RUN pnpm install --frozen-lockfile --filter . --filter @playerone/console... --filter @playerone/api...
RUN pnpm -F @playerone/design build:css && pnpm -F @playerone/console build
COPY deploy ./deploy

# Explicit one-off owner credential job. Never used as the web start command.
FROM build AS migrate
ARG PLAYERONE_SOURCE_SHA=unknown
LABEL org.opencontainers.image.revision=$PLAYERONE_SOURCE_SHA
USER node
CMD ["pnpm", "db:migrate"]

FROM base AS runtime
ENV NODE_ENV=production PORT=3000 PLAYERONE_SECURE_COOKIES=1
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/api ./packages/api
COPY --from=build --chown=node:node /app/packages/store ./packages/store
COPY --from=build --chown=node:node /app/packages/contracts ./packages/contracts
# The API does not start without this one. `packages/api/src/collector-upload.ts`
# imports `../../ingest/src/ingest.ts` at module load, because a collector's
# uploaded session is measured by the same engine the counter uses. It was never
# copied here and `.dockerignore` never let it into the build context, so the
# image built and then died: `ERR_MODULE_NOT_FOUND` on the API child, and
# `showcase.mjs` exited with it. Measured on the runtime image of 6fac270.
COPY --from=build --chown=node:node /app/packages/ingest ./packages/ingest
COPY --from=build --chown=node:node /app/tools/analysers ./tools/analysers
COPY --from=build --chown=node:node /app/apps/console/dist ./apps/console/dist
COPY --from=build --chown=node:node /app/deploy ./deploy
# A named volume inherits the ownership of the image directory it covers, and
# this process runs as `node`. Without these two directories existing and owned
# here, Docker creates the media and backup volumes root-owned and the API
# cannot write a byte into its own media root. `deploy/cloud/cloud.env.example`
# points PLAYERONE_MEDIA_ROOT and PLAYERONE_BACKUP_DIR at them.
RUN mkdir -p /data/media /data/backups && chown node:node /data/media /data/backups
ARG PLAYERONE_SOURCE_SHA=unknown
LABEL org.opencontainers.image.revision=$PLAYERONE_SOURCE_SHA
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=4s --start-period=30s --retries=3 CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "deploy/showcase.mjs"]
