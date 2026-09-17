import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { describe, expect, it } from 'vitest';
import { configurationChecks, readEnvironment } from '../centre/check.mjs';
import { isApiPath } from '../http-server.mjs';

/**
 * The three files of `deploy/cloud/` have to agree with each other and with the
 * two they copy from — `deploy/http-server.mjs` for the browser policy and
 * `deploy/centre/centre.env.example` for the variable names. Nothing here
 * provisions a VM or starts a container: what this can prove is that the ports,
 * the paths, the variable names and the header block still line up, which is the
 * part most likely to rot. The running proof is in README.md, on the VM.
 *
 * Modelled on `deploy/centre/check.test.ts`, for the reason that file states:
 * Caddy is not installed on a development machine, so the comparison is textual
 * on purpose.
 */
const read = (path: string) => readFile(join(import.meta.dirname, path), 'utf8');
const caddyfile = await read('Caddyfile');
const compose = parse(await read('docker-compose.yml'));
const template = await read('cloud.env.example');
const env = readEnvironment(template);
const dockerfile = await read(join('..', '..', 'Dockerfile'));

const mountTarget = (service: string, volume: string): string | undefined =>
  (compose.services[service].volumes as string[])
    .find((mount) => mount.startsWith(`${volume}:`))
    ?.split(':')[1];

describe('the cloud listener and the console listener send the same headers', () => {
  it('revalidates HTML including SPA fallbacks without changing media or asset caching', () => {
    const htmlPolicy = /header\s*\{\s*Cache-Control "no-cache"\s*match header Content-Type text\/html\*\s*\}/;
    const match = htmlPolicy.exec(caddyfile);
    expect(match, 'HTML response matching also covers /review and /episodes/attention after rewriting').not.toBeNull();
    expect(match!.index).toBeLessThan(caddyfile.indexOf('handle /healthz'));
    const withoutHtmlPolicy = caddyfile.replace(htmlPolicy, '');
    expect(withoutHtmlPolicy).not.toMatch(/Cache-Control\s+"?no-cache/);
    expect(withoutHtmlPolicy).toContain('header Cache-Control no-store');
  });

  it('carries the console CSP verbatim, and the other three headers', async () => {
    const server = await read(join('..', 'http-server.mjs'));
    const csp = /content-security-policy', "([^"]+)"/.exec(server)?.[1];
    expect(csp, 'the console listener still sets a CSP').toBeTruthy();
    expect(caddyfile).toContain(`Content-Security-Policy "${csp}"`);
    for (const [header, value] of [
      ['X-Content-Type-Options', 'nosniff'],
      ['Referrer-Policy', 'strict-origin-when-cross-origin'],
      ['X-Frame-Options', 'DENY'],
    ] as const) {
      expect(server.toLowerCase()).toContain(`'${header.toLowerCase()}', '${value.toLowerCase()}'`);
      expect(caddyfile).toContain(`${header} ${value}`);
    }
  });

  /**
   * HSTS is the one header this kit does not copy from the showcase listener.
   * That listener sends `max-age=31536000`; the API sends the same policy with
   * `includeSubDomains`, and this deployment is always HTTPS, so the stronger of
   * the two covers the static console and the proxied API alike.
   */
  it("sends the API's own HSTS policy, not the weaker showcase one", async () => {
    const api = await read(join('..', '..', 'packages', 'api', 'src', 'index.ts'));
    const policy = /'strict-transport-security', '([^']+)'/.exec(api)?.[1];
    expect(policy).toBe('max-age=31536000; includeSubDomains');
    expect(caddyfile).toContain(`Strict-Transport-Security "${policy}"`);
  });

  it('sends them site-wide and after the response, so nothing upstream doubles them', () => {
    const header = caddyfile.indexOf('header {');
    expect(header).toBeGreaterThan(-1);
    expect(header).toBeLessThan(caddyfile.indexOf('handle '));
    // Without `defer`, `reverse_proxy` adds the API's own headers to the ones
    // Caddy already set: two Strict-Transport-Security lines, of which RFC 6797
    // makes a browser obey the first. Measured on this kit before `defer`.
    expect(caddyfile.slice(header, caddyfile.indexOf('}', header))).toMatch(/^\s*defer$/m);
  });
});

describe('the Caddyfile, the compose file and the env template agree', () => {
  it('serves optional aliases alongside the unchanged primary hostname', () => {
    expect(caddyfile).toContain('{$PLAYERONE_PUBLIC_URL} {$PLAYERONE_PUBLIC_ALIASES} {');
    expect(env.PLAYERONE_PUBLIC_ALIASES).toBe('');
    expect(compose.services.caddy.env_file).toContain('cloud.env');
  });
  it('proxies only paths the API owns, and every path the console needs', async () => {
    const handled = [...caddyfile.matchAll(/^\t@(?:api|media) path (.+)$/gm)].flatMap(m => m[1]!.trim().split(/\s+/));
    expect(handled).not.toHaveLength(0);
    for (const path of handled) {
      expect(isApiPath(path.replace(/\/\*$/, '/x')), `${path} is an API path`).toBe(true);
    }
    const proxy = await read(join('..', 'http-server.mjs'));
    const roots = [.../const API_ROOTS = \[([^\]]+)\]/.exec(proxy)![1]!.matchAll(/'([^']+)'/g)].map(m => m[1]!);
    expect(roots).not.toHaveLength(0);
    for (const root of roots) {
      expect(handled).toContain(root);
      expect(handled).toContain(`${root}/*`);
    }
    expect(handled).toContain('/episodes/*');
    expect(handled).not.toContain('/episodes');
    expect(isApiPath('/episodes/attention')).toBe(false);
    expect(caddyfile).toMatch(/handle \/episodes\/attention\s*\{\s*root \* "\{\$PLAYERONE_CONSOLE_ROOT\}"\s*rewrite \* \/index\.html\s*file_server/);
    for (const matcher of ['api', 'media']) expect(caddyfile).toMatch(new RegExp(`handle @${matcher} \\{\\s+reverse_proxy 127\\.0\\.0\\.1:`));
  });

  it('asks the API for /whoami and reads 401 as ready, in the proxy and in the container', () => {
    // `deploy/http-server.mjs` answers /healthz exactly this way, and the API
    // has no health route of its own. A probe this listener answered by itself
    // would report the proxy's health and call it the deployment's.
    expect(caddyfile).toMatch(/handle \/healthz \{[\s\S]*rewrite \/whoami[\s\S]*@ready status 401/);
    const probe = (compose.services.api.healthcheck.test as string[]).join(' ');
    expect(probe).toContain('/whoami');
    expect(probe).toContain('401');
  });

  it('reaches the API only over loopback, on the port the template sets', () => {
    const upstreams = [...caddyfile.matchAll(/reverse_proxy (\S+)/g)].map((m) => m[1]);
    expect(new Set(upstreams)).toEqual(new Set(['127.0.0.1:{$PORT}']));
    expect(env.PORT).toBe('8080');
    expect(env.HOST).toBe('127.0.0.1');
    // Why the API can keep a loopback HOST and still be reachable by Caddy, and
    // why the forwarded client address is trustworthy at all — see the "address
    // is the socket" section of `packages/api/src/ratelimit.ts`.
    expect(compose.services.api.network_mode).toBe('service:caddy');
    expect(compose.services.api.ports, 'the API must never be published').toBeUndefined();
    expect(env.PLAYERONE_TRUST_LOOPBACK_PROXY).toBe('1');
    expect(compose.services.caddy.ports).toEqual(['80:80', '443:443']);
  });

  it('mounts each volume where the template says that directory is', () => {
    expect(mountTarget('caddy', 'console')).toBe(env.PLAYERONE_CONSOLE_ROOT);
    expect(caddyfile).toContain('root * "{$PLAYERONE_CONSOLE_ROOT}"');
    expect(mountTarget('api', 'media')).toBe(env.PLAYERONE_MEDIA_ROOT);
    expect(mountTarget('api', 'backups')).toBe(env.PLAYERONE_BACKUP_DIR);
    for (const name of ['media', 'backups', 'console', 'db', 'caddy_data', 'caddy_config']) {
      expect(compose.volumes, `${name} is a named volume`).toHaveProperty(name);
    }
    // A named volume inherits the ownership of the image directory it covers,
    // and the runtime runs as `node`. If the Dockerfile stops creating these two
    // directories, Docker creates the volumes root-owned and the API cannot
    // write a byte into its own media root.
    expect(dockerfile).toContain(`mkdir -p ${env.PLAYERONE_MEDIA_ROOT} ${env.PLAYERONE_BACKUP_DIR}`);
    expect(dockerfile).toContain(`chown node:node ${env.PLAYERONE_MEDIA_ROOT} ${env.PLAYERONE_BACKUP_DIR}`);
  });

  it("builds the API from this repository's Dockerfile, which carries ffmpeg", () => {
    expect(dockerfile).toContain('COPY patches ./patches');
    expect(compose.services.api.build).toMatchObject({ context: '../..', dockerfile: 'Dockerfile', target: 'runtime' });
    // The API needs ffprobe itself (`risk/media.ts`, and the ingest engine it
    // imports). Pinned to bookworm's series, not to one point release.
    expect(dockerfile).toMatch(/ffmpeg=7:5\.1\.\*/);
    // The image's own entrypoint is the Railway showcase, which serves the
    // console and proxies the API. Here Caddy does both.
    expect(compose.services.api.command).toEqual(['node', 'packages/api/bin/serve.ts']);
  });

  it('keeps a database on this VM optional, and names the service it ships', () => {
    expect(compose.services.postgres.profiles).toEqual(['db']);
    expect(new URL(env.DATABASE_URL!).hostname).toBe('postgres');
    // Migration 0021's role. `packages/store/src/db.ts` refuses a superuser.
    expect(new URL(env.DATABASE_URL!).username).toBe('playerone_app');
    expect(mountTarget('postgres', 'db')).toBe('/var/lib/postgresql/data');
  });
});

describe('the template is the deployment this kit claims to be', () => {
  it('uses the template environment names in every cloud script', async () => {
    const sources = await Promise.all(['configure.mjs', 'ops.mjs', 'probe.mjs', 'common.sh', 'up.sh', 'verify.sh', 'backup.sh', 'restore.sh'].map(read));
    for (const source of sources) {
      for (const match of source.matchAll(/(?:\benv\.|\bsetting )([A-Z][A-Z0-9_]+)/g)) expect(env, match[1]).toHaveProperty(match[1]!);
    }
    for (const match of (await read('docker-compose.yml')).matchAll(/\$\{([A-Z][A-Z0-9_]+)/g)) expect(env, match[1]).toHaveProperty(match[1]!);
    expect(new URL(env.DATABASE_URL!).pathname).toBe('/' + env.POSTGRES_DB);
    expect(new URL(env.OWNER_DATABASE_URL!).pathname).toBe('/' + env.POSTGRES_DB);
  });
  it('names every binding P0-1 check in the verifier', async () => {
    const verify = await read('verify.sh');
    for (const acceptance of ['Source SHA', 'image-id', 'VN VM/DB/bucket', 'HTTPS redirect', 'certificate expiry',
      'headers', '/healthz', 'authenticated console', 'machine + operator tokens', 'nested GET /episodes SPA',
      'PUT + read-back SHA-256', 'probe cleanup', 'bucket-cors.mjs', 'e2e-loop.mjs',
      'separately named throwaway DB', 'demo row counts unchanged', 'real Ego session', 'card-intake.mjs', 'reviewer role reaches origin']) expect(verify).toContain(acceptance);
    expect(verify).toContain('SKIPPED');
    expect(verify).toContain('verify-');
  });
  it('backs up before restoring into a new database and compares all public table counts', async () => {
    const backup = await read('backup.sh'), restore = await read('restore.sh');
    expect(backup).toContain('pg_dump');
    expect(backup).toContain('counts.json');
    expect(restore).toContain('create-restore');
    expect(restore).toContain('pg_restore');
    expect(restore).toContain('row counts');
    expect(restore).not.toContain('--clean');
  });
  it('runs owner migrations separately from the unprivileged server and includes CLI inputs', async () => {
    expect(compose.services.migrate.build.target).toBe('migrate');
    expect(compose.services.api.environment.OWNER_DATABASE_URL).toBe('');
    const up = await read('up.sh');
    for (const step of ['migrate', 'grant', 'bootstrap', 'seed-stakeholder.mjs', 'backup.sh', 'preflight']) expect(up).toContain(step);
    const ignore = await read(join('..', '..', '.dockerignore'));
    for (const file of ['bootstrap.ts', 'seed-stakeholder.mjs', 'seed-demo.mjs', 'seed-demo-work.mjs', 'e2e-loop.mjs', 'session-footage.mjs', 'card-intake.mjs', 'bucket-cors.mjs']) expect(ignore).toContain(file);
  });
  /**
   * The centre kit's own preflight, run against this template with its
   * placeholders filled. Everything it demands of a centre it demands here,
   * under the same variable names — which is the point of reusing them.
   *
   * The two ZNS refusals are the deliberate, documented gap: this VM runs the
   * loop before VNG has issued a ZNS account, so sign-in codes are logged and
   * not delivered, and no real collector signs in on it. README.md says so, and
   * `cloud.env.example` says what to set when the account exists.
   */
  it('passes the centre preflight except for the two documented ZNS refusals', () => {
    const filled = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, value
      .replace('REPLACE_PUBLIC_HOSTNAME', 'console.deployment.invalid')
      .replace('REPLACE_GREENNODE_S3_ENDPOINT', 'storage.deployment.invalid')
      .replace('REPLACE_ACTUAL_ALLOCATION_BYTES', '200000000000')
      .replace('REPLACE_OPERATIONS_EMAIL', 'operations@deployment.invalid')
      .replace(/REPLACE_[A-Z_]+/, 'f'.repeat(64))]));
    const failures = configurationChecks(filled).filter((r: { level: string }) => r.level === 'FAIL');
    expect(failures.map((r: { check: string }) => r.check).sort()).toEqual(['zns', 'zns-mode']);
  });

  it('states the review, reviewer-media, payout and gateway posture this VM is for', () => {
    expect(env.REVIEW_VERIFICATION_GATE).toBe('cloud');
    expect(env.PLAYERONE_REVIEWER_MEDIA).toBe('0');
    expect(env.PLAYERONE_PAYOUT_MODE).toBe('manual');
    expect(env.PLAYERONE_ZALOPAY_ENV).toBe('sandbox');
    expect(env.PLAYERONE_ZNS_ENV).toBe('sandbox');
    expect(env.PLAYERONE_SECURE_COOKIES).toBe('1');
  });

  it('ships no credential: every secret is still a placeholder', () => {
    for (const name of ['PLAYERONE_TOKEN_SECRET', 'PLAYERONE_MACHINE_SECRET', 'PLAYERONE_OPERATOR_SECRET',
      'STORAGE_KEY', 'STORAGE_SECRET', 'POSTGRES_PASSWORD']) {
      expect(env[name], name).toMatch(/^REPLACE_[A-Z_]+$/);
    }
    expect(env.DATABASE_URL).toContain('REPLACE_DATABASE_PASSWORD');
    /**
     * A demo phone's sign-in code comes back in the RESPONSE; not on a public
     * hostname. The centre preflight refuses it in https-production anyway.
     *
     * Asserted on the parsed variable and no longer on the raw text, because
     * `PLAYERONE_DEMO_PHONES` — the log allowlist added with the sign-in
     * channels — contains this name as a prefix and is a different thing under
     * a different rule: a container log an operator reads on the VM is not a
     * response the internet can ask for. The ban is on the echo.
     */
    expect(env.PLAYERONE_DEMO_PHONE).toBeUndefined();
    /**
     * And the allowlist ships EMPTY. The log sender is this template's own
     * fallback (sandbox, no ZNS credentials), so a value here would be a
     * deployment that writes that number's one-time codes into its log without
     * anybody having asked for it. `--demo-phone` is how a demo asks.
     */
    expect(env.PLAYERONE_DEMO_PHONES).toBe('');
  });
});
