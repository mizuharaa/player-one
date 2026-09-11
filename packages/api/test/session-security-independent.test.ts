import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, hashCredential } from '../src/index.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

// Independent acceptance: fresh disposable database, never the operational demo.
useDatabase(`api_session_security_${randomUUID().replaceAll('-', '').slice(0, 10)}`);
describe.skipIf(!hasDb())('independent session normalization and hostile inputs', () => {
  let app: Awaited<ReturnType<typeof buildApi>>;
  const credentials = { role: 'operator', machine_identifier: 'QA MACHINE', machine_secret: 'inside  spaces', external_ref: 'QA OPERATOR', operator_secret: 'inside  spaces' };
  beforeEach(async () => {
    await truncate();
    const d = await db(); const centre = randomUUID(); const hash = await hashCredential('inside  spaces');
    await d.execute(sql`insert into upload_centres(id,region,name,status) values(${centre},'HCM','Independent auth QA','active')`);
    await d.execute(sql`insert into upload_devices(id,upload_centre_id,machine_identifier,status,credential_hash) values(${randomUUID()},${centre},'QA MACHINE','active',${hash})`);
    await d.execute(sql`insert into operators(id,upload_centre_id,external_ref,role,credential_hash) values(${randomUUID()},${centre},'QA OPERATOR','admin',${hash})`);
    app = await buildApi({ db: await appDb(), tokenSecret: 'independent-isolated-test-key', secureCookies: true });
  });
  afterEach(async () => { await app?.close(); });
  afterAll(closeDb);

  it('normalizes only edge whitespace across session and both token endpoints', async () => {
    const session = await app.inject({ method: 'POST', url: '/api/session', payload: Object.fromEntries(Object.entries(credentials).map(([k,v]) => [k, ` \t${v}\n `])) });
    expect(session.statusCode).toBe(200);
    const cookies = session.headers['set-cookie'] as string[];
    expect(cookies).toHaveLength(2);
    for (const cookie of cookies) { expect(cookie).toContain('HttpOnly'); expect(cookie).toContain('SameSite=Strict'); expect(cookie).toContain('Secure'); }
    for (const [url, payload] of [['/auth/machine', { machine_identifier: '  QA MACHINE\t', secret: '\ninside  spaces ' }], ['/auth/operator', { external_ref: '\tQA OPERATOR ', secret: ' inside  spaces\n' }]] as const) {
      expect((await app.inject({ method: 'POST', url, payload })).statusCode).toBe(200);
    }
  });
  it('does not collapse internal spaces in identifiers or secrets', async () => {
    for (const patch of [{ operator_secret: 'inside spaces' }, { machine_identifier: 'QAMACHINE' }, { external_ref: 'QA  OPERATOR' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/session', payload: { ...credentials, ...patch } })).statusCode).toBe(401);
    }
  });
  it('refuses malformed credential values without throwing or setting a session', async () => {
    for (const value of [null, 42, {}, ['QA OPERATOR']]) {
      const res = await app.inject({ method: 'POST', url: '/api/session', payload: { ...credentials, external_ref: value } });
      expect(res.statusCode).toBe(401); expect(res.headers['set-cookie']).toBeUndefined();
    }
  });
  it('treats SQL and HTML credential strings literally and returns opaque JSON refusals', async () => {
    for (const value of ["' OR 1=1 --", '<img src=x onerror=alert(1)>', '${7*7}']) {
      const res = await app.inject({ method: 'POST', url: '/api/session', payload: { ...credentials, external_ref: value } });
      expect(res.statusCode).toBe(401); expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.headers['content-type']).toContain('application/json'); expect(res.body).not.toContain(value);
    }
    const [row] = await (await db()).execute(sql`select count(*)::int as n from operators`); expect(row!.n).toBe(1);
  });
  it('rejects NUL and oversized credentials before lookup or failed-login audit on all entry points', async () => {
    for (const value of ['bad\u0000input', 'x'.repeat(513)]) {
      for (const [url, payload] of [
        ['/api/session', { ...credentials, external_ref: value }],
        ['/api/session', { ...credentials, operator_secret: value }],
        ['/auth/machine', { machine_identifier: value, secret: 'inside  spaces' }],
        ['/auth/machine', { machine_identifier: 'QA MACHINE', secret: value }],
        ['/auth/operator', { external_ref: value, secret: 'inside  spaces' }],
        ['/auth/operator', { external_ref: 'QA OPERATOR', secret: value }],
      ] as const) {
        const res = await app.inject({ method: 'POST', url, payload });
        expect(res.statusCode).toBe(400); expect(res.headers['set-cookie']).toBeUndefined();
      }
    }
    const [row] = await (await db()).execute(sql`select count(*)::int as n from audit_events`); expect(row!.n).toBe(0);
  });
  it('rejects simple cross-origin form encodings and exposes no CORS grant', async () => {
    for (const contentType of ['text/plain', 'application/x-www-form-urlencoded']) {
      const res = await app.inject({ method: 'POST', url: '/api/session', headers: { origin: 'https://untrusted.example', 'content-type': contentType }, payload: JSON.stringify(credentials) });
      expect([400,401,415]).toContain(res.statusCode); expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    }
    const preflight = await app.inject({ method: 'OPTIONS', url: '/api/session', headers: { origin: 'https://untrusted.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
  });
});
