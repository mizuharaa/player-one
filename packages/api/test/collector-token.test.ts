import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApi, type SendSignInCode } from '../src/index.ts';
import { appDb, closeDb, db, hasDb, truncate, useDatabase } from '../../store/test/db.ts';

useDatabase('collector_token');

/**
 * One collector token, minted by the real sign-in route, used on the routes
 * three different branches built against three different guesses about it.
 *
 * WHY THIS FILE IS IN THE MERGE AND NOT ON A BRANCH. `feat/collector-auth`,
 * `feat/collector-money-api` and `feat/path-a-upload` each defined a
 * `CollectorClaims`, because none of them was on the remote when the others
 * started. Two of them minted a twelve-hour token with no epoch; one minted a
 * thirty-day token whose `epoch` is re-read from `collectors.token_epoch` on
 * every request. The three shapes cannot all be right, and nothing on any one
 * branch could prove which one the app would be handed.
 *
 * collector-auth's is the one that survived — it is the only one with a real
 * credential and a revocation story — and this file is the proof that the
 * other two branches' routes accept it. It signs no token of its own: every
 * request below carries what `POST /auth/collector/verify` returned.
 */

const SECRET = 'test-signing-key';
const uid = () => randomUUID();
const PHONE = '+84900000077';

describe.skipIf(!hasDb())('one collector token, across every collector route', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  const outbox: { phone: string; code: string }[] = [];
  const send: SendSignInCode = async (phone, code) => {
    outbox.push({ phone, code });
  };

  async function harness() {
    const d = await db();
    const collector = uid();
    await d.execute(sql`
      insert into collectors (id, external_ref, status, phone)
        values (${collector}, 'col-token', 'qualified', ${PHONE})`);
    const app = buildApi({ db: await appDb(), tokenSecret: SECRET, sendSignInCode: send });
    await app.ready();

    outbox.length = 0;
    const asked = await app.inject({
      method: 'POST',
      url: '/auth/collector/request-code',
      payload: { phone: PHONE },
    });
    expect(asked.statusCode, asked.body).toBe(204);
    const sent = outbox.at(-1);
    const verified = await app.inject({
      method: 'POST',
      url: '/auth/collector/verify',
      payload: { phone: PHONE, code: sent!.code },
    });
    expect(verified.statusCode, verified.body).toBe(200);
    return { d, app, collector, token: verified.json().token as string };
  }

  it('is accepted on the income route, the episodes route and the upload route', async () => {
    const h = await harness();
    const headers = { authorization: `Bearer ${h.token}` };

    // feat/collector-auth's own route, and the identity the other two read.
    const me = await h.app.inject({ method: 'GET', url: '/api/me', headers });
    expect(me.statusCode, me.body).toBe(200);
    expect(me.json()).toEqual({ role: 'collector', collector_id: h.collector });

    // feat/collector-money-api's routes. Empty for a collector with no
    // footage, which is the correct answer and still proves the guard let the
    // token through: without one these answer 401 or 403, not 200.
    const income = await h.app.inject({ method: 'GET', url: '/api/me/income', headers });
    expect(income.statusCode, income.body).toBe(200);

    const episodes = await h.app.inject({ method: 'GET', url: '/api/me/episodes', headers });
    expect(episodes.statusCode, episodes.body).toBe(200);

    /**
     * feat/path-a-upload's route. 503 because no object store is configured in
     * this file — that refusal comes from inside the handler, so the token
     * reached it. A rejected token never gets that far: it is 401 at the
     * guard, before any route body runs.
     */
    const upload = await h.app.inject({
      method: 'POST',
      url: '/api/me/uploads',
      payload: { id: uid(), collection_session_id: uid(), episode: {} } as never,
      headers,
    });
    expect(upload.statusCode).not.toBe(401);
    expect(upload.statusCode).not.toBe(403);
  });

  /**
   * The epoch is the reason collector-auth's shape won, so the merged tree has
   * to actually enforce it on the routes the other two branches wrote. A
   * twelve-hour token with no epoch was what they accepted.
   */
  it('stops working on every one of those routes the moment the collector is revoked', async () => {
    const h = await harness();
    const headers = { authorization: `Bearer ${h.token}` };
    expect((await h.app.inject({ method: 'GET', url: '/api/me/income', headers })).statusCode).toBe(200);

    await h.d.execute(sql`update collectors set token_epoch = token_epoch + 1 where id = ${h.collector}`);

    for (const url of ['/api/me', '/api/me/income', '/api/me/episodes']) {
      const res = await h.app.inject({ method: 'GET', url, headers });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(401);
    }
    const upload = await h.app.inject({
      method: 'POST',
      url: '/api/me/uploads',
      payload: { id: uid(), collection_session_id: uid(), episode: {} } as never,
      headers,
    });
    expect(upload.statusCode, upload.body).toBe(401);
  });

  /** The `/api/me` prefix is the collector's alone, in both directions. */
  it('refuses an operator token on the collector routes', async () => {
    const h = await harness();
    const centre = uid();
    const device = uid();
    const operator = uid();
    const { hashCredential } = await import('../src/index.ts');
    const hash = await hashCredential('correct horse');
    await h.d.execute(sql`insert into upload_centres (id, region, name, status)
      values (${centre}, 'HCM', 'centre HCM', 'active')`);
    await h.d.execute(sql`insert into upload_devices (id, upload_centre_id, machine_identifier, status, credential_hash)
      values (${device}, ${centre}, 'HCM-IMPORT-01', 'active', ${hash})`);
    await h.d.execute(sql`insert into operators (id, upload_centre_id, external_ref, role, credential_hash)
      values (${operator}, ${centre}, 'op-HCM', 'centre_operator', ${hash})`);

    const machine = await h.app.inject({
      method: 'POST',
      url: '/auth/machine',
      payload: { machine_identifier: 'HCM-IMPORT-01', secret: 'correct horse' },
    });
    const person = await h.app.inject({
      method: 'POST',
      url: '/auth/operator',
      payload: { external_ref: 'op-HCM', secret: 'correct horse' },
    });
    const staff = {
      'x-machine-token': `Bearer ${machine.json().token}`,
      authorization: `Bearer ${person.json().token}`,
    };
    for (const url of ['/api/me', '/api/me/income', '/api/me/episodes']) {
      const res = await h.app.inject({ method: 'GET', url, headers: staff });
      expect(res.statusCode, `${url}: ${res.body}`).toBe(403);
    }
  });
});
