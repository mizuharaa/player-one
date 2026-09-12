import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { configurationChecks, healthChecks, readEnvironment } from './check.mjs';
import { storageQuotaFromEnv } from '../../packages/api/src/alerts.ts';

const base = {
  PLAYERONE_DEPLOY_MODE: 'lan-demo', PLAYERONE_PUBLIC_URL: 'http://127.0.0.1', PLAYERONE_BIND: '127.0.0.1',
  DATABASE_URL: 'postgres://playerone_app:test-only@127.0.0.1/test_only',
  PLAYERONE_TOKEN_SECRET: 'f'.repeat(64), PLAYERONE_MEDIA_ROOT: 'C:/fixtures/media',
  PLAYERONE_MACHINE_IDENTIFIER: 'test-machine', PLAYERONE_MACHINE_SECRET: 'm'.repeat(64),
  PLAYERONE_OPERATOR_REF: 'test-operator', PLAYERONE_OPERATOR_SECRET: 'o'.repeat(64),
  STORAGE_ENDPOINT: 'https://storage.invalid', STORAGE_BUCKET: 'test', STORAGE_KEY: 'test', STORAGE_SECRET: 'test',
  PLAYERONE_STORAGE_QUOTA_BYTES: '200000000000', PLAYERONE_CONSOLE_ROOT: 'C:/fixtures/console',
  PLAYERONE_BACKUP_DIR: 'C:/fixtures/backups', HOST: '127.0.0.1', PORT: '8080',
  REVIEW_VERIFICATION_GATE: 'cloud', PLAYERONE_REVIEWER_MEDIA: '0', PLAYERONE_SECURE_COOKIES: '0',
  PLAYERONE_PAYOUT_MODE: 'manual', PLAYERONE_DEMO_PHONE: '+84900000001',
};
const failures = (env: Record<string, string | undefined>) => configurationChecks(env).filter((r: { level: string }) => r.level === 'FAIL');
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe('deployment configuration boundaries', () => {
  it.each([
    ['200', false], ['1249999999', false], ['1250000000', true],
    ['200000000000', true], ['2000000000000', true],
    ['9007199254740991', true], ['9007199254740992', false],
    ['1e12', false], ['-1', false], ['12a', false], ['1250000000.0', false],
    [' 1250000000', false], ['1250000000\n', false],
  ] as const)('quota %s agrees with API startup (accepted: %s)', (value, accepted) => {
    const env = { ...base, PLAYERONE_STORAGE_QUOTA_BYTES: value };
    const quotaFailures = failures(env).filter((r: { check: string }) => r.check === 'quota');
    expect(quotaFailures.length === 0).toBe(accepted);
    if (accepted) expect(storageQuotaFromEnv(env)).toBe(Number(value));
    else expect(() => storageQuotaFromEnv(env)).toThrow(/safe integer/);
  });

  it.each([undefined, ''])('preflight requires an explicit quota even when runtime tolerates %s', (value) => {
    const env = { ...base, PLAYERONE_STORAGE_QUOTA_BYTES: value };
    expect(storageQuotaFromEnv(env)).toBeUndefined();
    expect(failures(env)).toContainEqual(expect.objectContaining({ check: 'quota' }));
  });

  it('accepts an explicit LAN demo without weakening the cloud review gate', () => {
    expect(failures(base)).toEqual([]);
    expect(failures({ ...base, REVIEW_VERIFICATION_GATE: 'local' })).toEqual([
      expect.objectContaining({ check: 'review-gate' }),
    ]);
  });

  it('refuses HTTP on a public address and Secure cookies on a private HTTP origin', () => {
    expect(failures({ ...base, PLAYERONE_PUBLIC_URL: 'http://8.8.8.8', PLAYERONE_BIND: '8.8.8.8' }))
      .toContainEqual(expect.objectContaining({ check: 'lan-origin' }));
    expect(failures({ ...base, PLAYERONE_SECURE_COOKIES: '1' }))
      .toContainEqual(expect.objectContaining({ check: 'cookies' }));
    expect(failures({ ...base, PLAYERONE_PUBLIC_URL: 'http://10.attacker.invalid', PLAYERONE_BIND: '10.attacker.invalid' }))
      .toContainEqual(expect.objectContaining({ check: 'lan-origin' }));
  });

  it('discloses undelivered codes with or without a demo phone, without leaking its number', () => {
    for (const phone of [undefined, '+84912345678']) {
      const findings = configurationChecks({ ...base, PLAYERONE_DEMO_PHONE: phone });
      expect(findings).toContainEqual(expect.objectContaining({
        level: 'NOTE', check: 'sign-in-code-log',
        message: expect.stringContaining('deploy/centre/logs/api-YYYY-MM-DD.log'),
      }));
      expect(JSON.stringify(findings)).not.toContain('+84912345678');
    }
    expect(configurationChecks({ ...base,
      PLAYERONE_ZNS_ACCESS_TOKEN: 'test-only-token', PLAYERONE_ZNS_TEMPLATE_ID: 'test-only-template',
    })).not.toContainEqual(expect.objectContaining({ check: 'sign-in-code-log' }));
  });

  it('accepts HTTPS only with secure cookies, real ZNS configuration and no demo autofill', () => {
    const production = { ...base, PLAYERONE_DEPLOY_MODE: 'https-production',
      PLAYERONE_PUBLIC_URL: 'https://deployment.invalid', PLAYERONE_SECURE_COOKIES: '1',
      PLAYERONE_DEMO_PHONE: undefined, PLAYERONE_ZNS_ENV: 'production',
      PLAYERONE_ZNS_ACCESS_TOKEN: 'test-only-token', PLAYERONE_ZNS_TEMPLATE_ID: 'test-only-template' };
    expect(failures(production)).toEqual([]);
    expect(failures({ ...production, PLAYERONE_DEMO_PHONE: '+84900000001' }))
      .toContainEqual(expect.objectContaining({ check: 'demo-phone' }));
    expect(failures({ ...production, PLAYERONE_ZNS_ACCESS_TOKEN: undefined }))
      .toContainEqual(expect.objectContaining({ check: 'zns' }));
  });

  it('refuses production ZNS without credentials even on a LAN demo', () => {
    const findings = configurationChecks({ ...base, PLAYERONE_ZNS_ENV: 'production' });
    expect(findings).toContainEqual(expect.objectContaining({ level: 'FAIL', check: 'zns' }));
    expect(findings).not.toContainEqual(expect.objectContaining({ check: 'sign-in-code-log' }));
  });

  it('refuses an owner database connection, inherited reviewer access and a live payout rail', () => {
    const findings = failures({ ...base, DATABASE_URL: 'postgres://postgres:test-only@127.0.0.1/test_only',
      PLAYERONE_REVIEWER_MEDIA: '1', PLAYERONE_PAYOUT_MODE: 'api' });
    for (const check of ['database-role', 'reviewer-media', 'payout-mode']) {
      expect(findings).toContainEqual(expect.objectContaining({ check }));
    }
  });

  it('reports a placeholder inside a credential without exposing any value', () => {
    const secret = 'private-prefix-REPLACE-secret-suffix';
    const findings = failures({ ...base, STORAGE_SECRET: secret });
    expect(findings).toContainEqual(expect.objectContaining({ check: 'STORAGE_SECRET' }));
    expect(JSON.stringify(findings)).not.toContain(secret);
    expect(JSON.stringify(findings)).not.toContain('private-prefix');
  });

  it('refuses stale gateway credentials and an invalid sign-in environment before startup', () => {
    const findings = failures({ ...base, PLAYERONE_ZALOPAY_KEY1: 'stale-secret', PLAYERONE_ZNS_ENV: 'typo' });
    expect(findings).toContainEqual(expect.objectContaining({ check: 'gateway-scope' }));
    expect(findings).toContainEqual(expect.objectContaining({ check: 'zns-mode' }));
    expect(JSON.stringify(findings)).not.toContain('stale-secret');
  });

  it('parses the documented file safely and refuses duplicate or quoted entries', () => {
    expect(readEnvironment('# comment\r\nA=one\r\nPATH=C:\\Program Files\\nodejs\\node.exe\r\n'))
      .toEqual({ A: 'one', PATH: 'C:\\Program Files\\nodejs\\node.exe' });
    for (const text of ['A=one\nA=two', 'A="secret&command"', ' export A=secret', 'A=secret ']) {
      expect(() => readEnvironment(text)).toThrow(/line/);
    }
  });

  it('the CLI exits nonzero on an unusable template and never echoes a secret', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'po-deploy-check-'));
    cleanup.push(() => rm(dir, { recursive: true, force: true }));
    const envFile = join(dir, 'centre.env');
    const secret = 'do-not-print-this-test-secret';
    await writeFile(envFile, `DATABASE_URL=postgres://postgres:${secret}@127.0.0.1/test\n`);
    const run = await promisify(execFile)(process.execPath, ['deploy/centre/check.mjs', 'preflight', envFile],
      { windowsHide: true }).catch((error) => error);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain('FAIL');
    expect(run.stdout + run.stderr).not.toContain(secret);
  });
});

async function server(options: { brokenAsset?: boolean; fallback?: boolean; apiDown?: boolean } = {}) {
  const seen: { path: string; authorization?: string; machine?: string }[] = [];
  const app = createServer((req, res) => {
    seen.push({ path: req.url!, authorization: req.headers.authorization, machine: req.headers['x-machine-token'] as string });
    if (req.url === '/whoami' && !options.fallback) {
      res.setHeader('content-type', 'application/json');
      if (options.apiDown) { res.writeHead(500); res.end('{"error":"internal","ref":"fixture"}'); return; }
      if (req.headers.authorization === 'Bearer fixture-operator' && req.headers['x-machine-token'] === 'Bearer fixture-machine') {
        res.end('{"role":"operator","operator_id":"fixture","upload_device_id":"fixture-machine"}'); return;
      }
      res.writeHead(401); res.end('{"error":"sign in required"}'); return;
    }
    if (req.url === '/assets/app.js' && !options.brokenAsset) {
      res.setHeader('content-type', 'application/javascript'); res.end('/* fixture */'); return;
    }
    res.setHeader('content-type', 'text/html');
    res.end('<div id="root"></div><script src="/assets/app.js"></script>');
  });
  await new Promise<void>((resolve) => app.listen(0, '127.0.0.1', resolve));
  cleanup.push(async () => {
    app.closeAllConnections();
    await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  });
  return { seen, origin: `http://127.0.0.1:${(app.address() as { port: number }).port}` };
}

describe('read-only deployment health over real HTTP', () => {
  it('proves routes/assets but explicitly leaves database health unproven without tokens', async () => {
    const f = await server();
    const findings = await healthChecks({ PLAYERONE_PUBLIC_URL: f.origin });
    expect(findings.filter((r: { level: string }) => r.level === 'FAIL')).toEqual([]);
    expect(findings).toContainEqual(expect.objectContaining({ check: 'database-unproven' }));
    expect(f.seen.map((r) => r.path)).toEqual(['/', '/assets/app.js', '/whoami']);
  });

  it('rejects an API route swallowed by the SPA and an entry script replaced with HTML', async () => {
    const f = await server({ fallback: true, brokenAsset: true });
    const findings = await healthChecks({ PLAYERONE_PUBLIC_URL: f.origin });
    for (const check of ['console', 'identity']) expect(findings).toContainEqual(expect.objectContaining({ check, level: 'FAIL' }));
  });

  it('uses existing tokens without creating a session or printing identity data', async () => {
    const f = await server();
    const findings = await healthChecks({ PLAYERONE_PUBLIC_URL: f.origin,
      PLAYERONE_HEALTH_OPERATOR_TOKEN: 'fixture-operator', PLAYERONE_HEALTH_MACHINE_TOKEN: 'fixture-machine' });
    expect(findings).toContainEqual(expect.objectContaining({ check: 'identity', level: 'OK' }));
    expect(f.seen.at(-1)).toMatchObject({ path: '/whoami', authorization: 'Bearer fixture-operator', machine: 'Bearer fixture-machine' });
    expect(JSON.stringify(findings)).not.toContain('fixture-operator');
  });

  it('fails on an API 500 instead of declaring the server healthy because HTML loads', async () => {
    const f = await server({ apiDown: true });
    expect(await healthChecks({ PLAYERONE_PUBLIC_URL: f.origin }))
      .toContainEqual(expect.objectContaining({ check: 'identity', level: 'FAIL' }));
  });
});
