# Deploy the PlayerOne showcase

This package serves the built Vite UI and the existing Fastify API on one HTTPS
origin. Railway's trusted client-address mode is prepared. The Docker shape also
fits a Render web service, but Render's trusted client-address contract must be
implemented and verified before enabling public authentication there. No service,
database, domain or deployment has been created by adding these files.

## Runtime shape

`node deploy/showcase.mjs` listens on `0.0.0.0:$PORT` (3000 locally), serves only
`apps/console/dist`, and starts the unchanged API entrypoint as a child process
on loopback port 8081. `PLAYERONE_API_PORT` can choose another internal port;
when public `PORT=8081`, the default child port automatically becomes 8082.

The proxy carries request bodies, cookies and multiple `Set-Cookie` headers
unchanged. `/api`, `/auth`, `/media`, `/whoami`, `/reference`, `/handovers` and
`/upload-batches` route to the API at their exact root or beneath a slash.
**Bare `/episodes` is the SPA; `/episodes/…` is the API.** Ordinary SPA deep links
return `index.html`. Missing media/assets return 404 instead of HTML.

MP4s stream from disk with bounded, suffix and open-ended byte-range support;
HEAD requests ignore Range and return full-representation headers without a body.
Unknown range units are ignored, and If-Range dates require an exact Last-Modified
match. Static paths reject
traversal, dotfiles, source maps and symlinks outside the dist directory.
Hashed `/assets/` files cache immutably; HTML does not cache.

`GET /healthz` returns 200 only while the API answers its existing `/whoami`
authentication guard with 401. API startup already checks its database
connection. This endpoint does not execute a new database query on every probe
and is not an end-to-end sign-in or payout check. SIGTERM closes the frontend
and API, with a ten-second termination deadline; unexpected API exit stops the
frontend so the host can restart the service.

## Required runtime configuration

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Runtime **playerone_app** credentials, with explicit `sslmode=require` for an encrypted remote database. Never the migration owner's URL. |
| `PLAYERONE_TOKEN_SECRET` | A persistent generated secret, supplied through the host's secret manager. |
| `PLAYERONE_SECURE_COOKIES` | `1` behind HTTPS; the runtime image defaults to this. Set `0` only for a local plain-HTTP smoke test. |
| `PORT` | Host-assigned public listener port; the frontend binds all interfaces. |
| `PLAYERONE_PROXY_MODE` | `railway` only when every inbound request passes through Railway's managed HTTP ingress. `direct` uses the socket IP and ignores all caller-supplied forwarding headers. An HTTPS deployment must explicitly select a mode. |

Railway documents a single client address in `X-Real-IP` in its
[public-networking contract](https://docs.railway.com/networking/public-networking/specs-and-limits).
In Railway mode, missing or malformed addresses reject API requests; the frontend
never falls back to arbitrary `X-Forwarded-For`. It strips incoming forwarding
chains and writes one sanitized address for the child API. The child enables
`PLAYERONE_TRUST_LOOPBACK_PROXY=1` only on a loopback listener; Fastify trusts
only `127.0.0.1/32` and `::1/128`. Default standalone API behavior stays unchanged.
This keeps distinct visitors out of one shared login-rate-limit bucket without
making headers from remote API peers trusted.

**Railway mode is an operator-selected network boundary, not proof supplied by
an HTTP header.** Do not enable a direct public TCP listener or alternate
untrusted route to this frontend when Railway mode is enabled. A spoofed
`X-Railway-*` header never activates it. Verify the actual edge rewrites
`X-Real-IP` in the deployed service before enabling public sign-in. `direct` is
for local/direct clients; it does not recover visitor identities behind an
arbitrary hosting proxy. Render's XFF chain is not blindly trusted: a separately
verified adapter is required before calling its public authentication ready.

The package does not enable reviewer-media playback, payout credentials, a
production SMS provider or storage. Keep those feature variables at their
existing defaults until their actual dependencies and approvals are available.
Runtime API code includes the existing analysis modules, but the slim image does
not install FFmpeg/Python, the spawned `packages/api/scripts/moov.ts` helper,
or `packages/hardware-checkout/corpus_check.py`, and does not mount recordings.
Mounting media does not make the analysis pipeline complete: those optional
runtime dependencies must be packaged and independently checked first.
Showcase footage under the console's
public directory is part of the built website; real collector recordings are not.

The API's existing pilot sign-in-code delivery falls back to server logs without
a configured ZNS sender. The package does not create users or invent a demo
account. Existing database users and product provisioning still govern sign-in.
See [RUNNING.md](RUNNING.md) for those workflows and environment variables.

**First-login provisioning remains required.** No remote database, operator,
machine identity or credentials are assumed to exist. After the owner selects
the host/database, provision those identities non-destructively through the
existing supported workflow, then verify an actual remote sign-in. Proxy tests
do not demonstrate a working account, and fixed fake credentials or seeded
money data are not part of this package.

## Database setup stays separate

Apply migrations once as the database owner before starting the web service:

```sh
docker build --target migrate -t playerone-showcase-migrate .
docker run --rm --env-file /secure/path/playerone-owner.env playerone-showcase-migrate
```

The owner env file contains only the migration `DATABASE_URL`. It remains
outside the repository and build context. The migrations create roles including
`playerone_app`; the database provider must permit that role setup. As the owner,
enable login for the runtime role using a generated password:

```sql
ALTER ROLE playerone_app LOGIN PASSWORD '<generated runtime password>';
```

Use that role's distinct URL for the running service. Existing migrations and
role details are in [RUNNING.md](RUNNING.md#the-database-user-the-api-connects-as).
Do not put the owner URL in the web service, and do not run migrations on every
web restart. **Never use `pnpm seed` or `seed-console.mjs` during deployment: that
fixture script truncates tables.** No seed script is copied into this image.

## Build and run locally

```sh
docker build -t playerone-showcase .
docker run --rm -p 3000:3000 --env-file /secure/path/playerone-runtime.env \
  -e PLAYERONE_SECURE_COOKIES=0 playerone-showcase
```

The runtime env file supplies the runtime `DATABASE_URL` and token secret.
Open `http://localhost:3000/discover`; check `http://localhost:3000/healthz`.
The Dockerfile uses Node 22 (which supports native TypeScript stripping), pinned
pnpm 9.15.9, a frozen lockfile and a production Vite build. The runtime runs as
the unprivileged `node` user. `.dockerignore` allowlists source, migrations,
website assets and deployment code; credentials, docs media, SDKs, corpus,
scratchpad, local node_modules and agent artifacts are excluded.

## Railway

1. Connect the intended repository and branch to a new service in the owner's
   project. Keep the repository root as the source directory.
2. Railway detects the root Dockerfile; `railway.toml` sets `/healthz`, a
   120-second startup health timeout and bounded restart-on-failure behavior.
3. Set `PLAYERONE_PROXY_MODE=railway`, supply the remaining runtime variables
   from the table and connect the separately migrated
   database. Do not substitute the provider's owner URL for `playerone_app`.
4. Generate/attach the intended HTTPS domain and deploy the reviewed commit.

Railway's [Dockerfile documentation](https://docs.railway.com/builds/dockerfiles)
and [health-check documentation](https://docs.railway.com/deployments/healthchecks)
describe the host-side settings.

## Render

The container/build steps below are prepared, but do not publish public sign-in
using `direct` behind Render's edge. Its client-address adapter is a remaining
integration dependency; Railway's `X-Real-IP` contract must not be assumed to
apply to Render.

1. Create a **Web Service**, connect the intended repository/branch, and select
   Docker. Dockerfile path is `./Dockerfile`; build context is the repo root.
2. Keep the Docker command unset so the image CMD starts the Node frontend/API
   supervisor. Set the health-check path to `/healthz`.
3. Supply the runtime variables and the separately migrated database. Keep owner
   migration credentials in a separate one-off job, not the web service.
4. Deploy and use the assigned HTTPS hostname or the owner's custom domain.

See Render's [Docker service documentation](https://render.com/docs/docker)
and [health checks](https://render.com/docs/health-checks).

## Verification handoff

The focused server tests exercise SPA/API routing, POST/cookie preservation,
single byte ranges, HEAD, unsatisfiable ranges, path/symlink guards, missing
assets, and API readiness/failure without connecting to a database:

```sh
node --test deploy/http-server.test.mjs
```

The independent reviewer should run them, build the Docker image, migrate an
isolated database, and check actual sign-in cookies plus MP4 seeking over the
host's HTTPS origin. Then stop/restart the container and confirm graceful
termination and `/healthz` readiness. Browser acceptance of the landing remains
separate from these transport checks. A deployable package is not evidence of a
published service or a working remote login.
