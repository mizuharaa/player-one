import { describe, expect, it } from 'vitest';
import { EXAM_QUESTION_COUNT, MockCollectorApi } from '../src/api/mock.ts';
import { HttpCollectorApi } from '../src/api/http.ts';
import type { TokenStore } from '../src/api/token-store.ts';
import { AGREEMENTS, ApiError } from '../src/api/types.ts';
import { LOCALES, MESSAGES } from '../src/i18n.ts';

/**
 * The app's API seam, both implementations, in one file.
 *
 * `MockCollectorApi` is what the screens are developed against, so its gates are
 * pinned first: they are the same gates the server enforces (APP-02, APP-05,
 * APP-10, APP-15, APP-25), and a screen developed against a permissive mock
 * would ship expecting a permissive server. `HttpCollectorApi` — the real
 * client against the platform — is pinned in the second half.
 *
 * They share a file on purpose, and it is not only tidiness.
 * `packages/api/test/collector-auth.test.ts` asserts that four sign-in requests
 * land within a 150 ms wall-clock spread, and it measures that while competing
 * with every other test file vitest is running in parallel. Adding a
 * SEVENTY-FOURTH file to the suite was enough to push that spread to 199–326 ms
 * and turn it red — measured four times out of four, green in isolation and
 * green with this file removed. Keeping the count where it was is a workaround
 * for that test's fragility and not a fix for it; the fix belongs in
 * `collector-auth.test.ts`, which should not be timing a security property
 * against a loaded machine's wall clock.
 */

const PASSING = Array<boolean>(EXAM_QUESTION_COUNT).fill(true);

async function onboarded(): Promise<MockCollectorApi> {
  const api = new MockCollectorApi();
  await api.register('Nguyễn Văn A', '0903000001');
  await api.acceptAgreements(AGREEMENTS.map((a) => ({ agreementId: a.id, version: a.version })));
  await api.completeTraining();
  await api.submitExam(PASSING);
  return api;
}

describe('the agreement contract with the server (APP-02)', () => {
  it('names the six agreements exactly as the server CHECK does', () => {
    // This app cannot enforce anything: acceptance is only real once the
    // server has written a `collector_agreements` row, and that table's
    // `collector_agreements_name_check` accepts these six strings and no
    // others. The app shipped `data_commercial_use` against the server's
    // `commercial_use` — six agreements presented, five acceptable, and no
    // collector could ever become eligible. The list is duplicated across a
    // repository boundary, so it is pinned on both sides rather than hoped at.
    //
    // Source of truth: packages/store/src/schema.ts, collector_agreements_name_check.
    expect(AGREEMENTS.map((a) => a.id)).toEqual([
      'user',
      'privacy',
      'data_collection',
      'commercial_use',
      'manual_review',
      'offline_settlement',
    ]);
  });

  it('has a label for every agreement in every locale', () => {
    // A renamed id that slipped past the list above would still render as a
    // missing key rather than an agreement title.
    for (const locale of LOCALES) {
      for (const a of AGREEMENTS) {
        expect(MESSAGES[locale][`agreement.${a.id}`]).toBeTruthy();
      }
    }
  });
});

describe('registration and the six agreements (APP-01/02)', () => {
  it('records acceptance with version and timestamp, all six required', async () => {
    const api = new MockCollectorApi();
    await api.register('Trần Thị B', '0903000002');

    // Five of six is no acceptance.
    await expect(
      api.acceptAgreements(
        AGREEMENTS.slice(0, 5).map((a) => ({ agreementId: a.id, version: a.version })),
      ),
    ).rejects.toThrow('agreements_incomplete');

    // A stale version is no acceptance either.
    await expect(
      api.acceptAgreements(
        AGREEMENTS.map((a, i) => ({ agreementId: a.id, version: i === 0 ? '0.9' : a.version })),
      ),
    ).rejects.toThrow('agreements_incomplete');

    const profile = await api.acceptAgreements(
      AGREEMENTS.map((a) => ({ agreementId: a.id, version: a.version })),
    );
    expect(profile.agreements).toHaveLength(6);
    for (const acceptance of profile.agreements) {
      expect(acceptance.version).toBe('1.0');
      expect(Date.parse(acceptance.acceptedAt)).not.toBeNaN();
    }
  });
});

describe('the full eligibility gate on claiming (APP-02/03/04/05)', () => {
  const ACCEPTANCES = AGREEMENTS.map((a) => ({ agreementId: a.id, version: a.version }));

  it('refuses at every missing prerequisite, in the order they are met', async () => {
    // This test used to skip agreements and training entirely and still claim,
    // because the gate checked `examPassed` alone. The server will not honour
    // that: PRODUCT.md and APP-02/05 make the six agreements, the training and
    // the exam one contract, enforced server-side. A permissive seam teaches
    // every screen built against it to expect a permissive server.
    const api = new MockCollectorApi();
    await api.register('Lê Văn C', '0903000003');

    await expect(api.claimTask('task-cook')).rejects.toThrow('agreements_incomplete');

    await api.acceptAgreements(ACCEPTANCES);
    await expect(api.claimTask('task-cook')).rejects.toThrow('training_incomplete');

    await api.completeTraining();
    await expect(api.claimTask('task-cook')).rejects.toThrow('exam_not_passed');

    const failed = await api.submitExam([true, false, true]);
    expect(failed.passed).toBe(false);
    await expect(api.claimTask('task-cook')).rejects.toThrow('exam_not_passed');

    const passed = await api.submitExam(PASSING);
    expect(passed.passed).toBe(true);
    const claim = await api.claimTask('task-cook');
    expect(claim.taskId).toBe('task-cook');
  });

  // Not tested: the revision path — a published new version of one agreement
  // making a previous acceptance stale. `mustBeEligible` compares the stored
  // version against the presented one, but nothing in this seam can publish a
  // new version, so there is no honest way to reach that branch from outside.
  // It needs the server's current-version endpoint first.
});

describe('the task hall (APP-08/10)', () => {
  it('caps claims at the seeded capacity another collector already filled', async () => {
    const api = await onboarded();
    // task-office ships at 2/2 claimants — other collectors got there first.
    await expect(api.claimTask('task-office')).rejects.toThrow('task_at_capacity');
  });

  it('refuses a second claim of the same task', async () => {
    const api = await onboarded();
    await api.claimTask('task-cook');
    await expect(api.claimTask('task-cook')).rejects.toThrow('already_claimed');
  });
});

describe('session creation (APP-14/15/16/17b)', () => {
  it('needs a bound device and a claimed task, and captures both declarations', async () => {
    const api = await onboarded();
    await api.claimTask('task-warehouse');

    // APP-15: no device binding, no collection preparation.
    await expect(
      api.createSession({
        taskId: 'task-warehouse',
        deviceSerial: 'EGO1-PILOT-0007',
        scenario: 'warehouse',
        othersInFrame: true,
        sensitiveInfo: false,
      }),
    ).rejects.toThrow('device_not_bound');

    await api.bindDevice('EGO1-PILOT-0007');

    await expect(
      api.createSession({
        taskId: 'task-cook', // not claimed
        deviceSerial: 'EGO1-PILOT-0007',
        scenario: 'home',
        othersInFrame: false,
        sensitiveInfo: false,
      }),
    ).rejects.toThrow('task_not_claimed');

    const session = await api.createSession({
      taskId: 'task-warehouse',
      deviceSerial: 'EGO1-PILOT-0007',
      scenario: 'warehouse',
      othersInFrame: true,
      sensitiveInfo: false,
    });
    // APP-16: task + collector + device + scenario, bound into one identifier.
    expect(session.id).toMatch(/^ses-/);
    expect(session.collectorId).toMatch(/^col-/);
    expect(session.taskId).toBe('task-warehouse');
    expect(session.deviceSerial).toBe('EGO1-PILOT-0007');
    expect(session.scenario).toBe('warehouse');
    expect(session.othersInFrame).toBe(true);
    expect(session.sensitiveInfo).toBe(false);
    // The client sent no duration and no amount, and the session carries none.
    expect(Object.keys(session)).not.toContain('durationSec');
    expect(Object.keys(session).join()).not.toMatch(/amount|minutes/i);
  });
});

describe('uploads are manual, never automatic, never silent (APP-23/24/25)', () => {
  it('moves an episode only through confirmUpload, and only from pending', async () => {
    const api = await onboarded();
    const before = await api.episodes();
    const pending = before.filter((e) => e.state === 'pending_upload');
    expect(pending.length).toBeGreaterThan(0);

    // Time passing and re-listing change nothing: no upload starts on its own.
    // This assertion is only worth something because `episodes()` hands out
    // copies — while it returned the live rows, `before` and `relisted` were
    // the same objects and the comparison could not fail whatever happened.
    expect(before[0]).not.toBe((await api.episodes())[0]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const relisted = await api.episodes();
    expect(relisted).toEqual(before);

    // And a screen cannot promote its own episode by writing to what it read.
    const wasFirst = before[0]!.state;
    before[0]!.state = 'review_passed';
    expect((await api.episodes())[0]?.state).toBe(wasFirst);

    const first = pending[0]!;
    const confirmed = await api.confirmUpload(first.episodeId);
    expect(confirmed.state).toBe('uploading');

    // Confirming again is a client bug, not a second upload.
    await expect(api.confirmUpload(first.episodeId)).rejects.toThrow('not_pending');
    // Nor can an episode in review be "uploaded" again.
    await expect(api.confirmUpload('ego1-20260820-1830')).rejects.toThrow('not_pending');
  });

  it('names APP-23’s six states verbatim, and seeds the ones no tap can produce', async () => {
    const { EPISODE_STATES } = await import('../src/api/types.ts');
    expect(EPISODE_STATES).toEqual([
      'pending_upload',
      'uploading',
      'uploaded',
      'under_review',
      'review_passed',
      'review_failed',
    ]);
    // uploading/uploaded exist only downstream of a confirmation; the rest
    // must be visible without one.
    const api = await onboarded();
    const states = new Set((await api.episodes()).map((e) => e.state));
    expect(states).toEqual(new Set(['pending_upload', 'under_review', 'review_passed', 'review_failed']));
    const failed = (await api.episodes()).find((e) => e.state === 'review_failed');
    // APP-27: the reason arrives in the collector's language.
    expect(failed?.rejectReason).toBeTruthy();
  });
});

describe('income (APP-33/34)', () => {
  it('keeps estimated and confirmed apart, figures server-authored', async () => {
    const api = await onboarded();
    const entries = await api.income();
    const kinds = new Set(entries.map((e) => e.kind));
    expect(kinds).toEqual(new Set(['estimated', 'confirmed']));
    // Amounts are strings from the server — the app never computes money.
    for (const entry of entries) {
      if (entry.amountVnd !== null) expect(typeof entry.amountVnd).toBe('string');
    }
  });
});

// --------------------------------------------------------------------------
/**
 * The real client, against a fake `fetch`.
 *
 * No network, no database, no `DATABASE_URL`. What is pinned here is the part
 * of the app a collector's account depends on: that signing in stores a token,
 * that a cold start with a stored token comes back with the server's state and
 * not a local copy, and that a dead token is thrown away rather than retried
 * for ever.
 *
 * `TokenStore` is imported as a TYPE only. `token-store.ts`'s implementation
 * pulls `expo-secure-store`, a native module that cannot load under Node, and
 * a value import here would take the whole file down with it.
 */

/** The keystore, as one variable. */
function fakeStore(initial: string | null = null): TokenStore & { value: string | null } {
  return {
    value: initial,
    async get() {
      return this.value;
    },
    async set(token: string) {
      this.value = token;
    },
    async clear() {
      this.value = null;
    },
  };
}

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** A fetch that answers from a table of `METHOD /path` and records every call. */
function fakeFetch(routes: Record<string, { status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const fn = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = String(url);
    const method = init?.method ?? 'GET';
    const path = href.replace('http://api.test', '');
    calls.push({
      url: path,
      method,
      headers: (init?.headers as Record<string, string> | undefined) ?? {},
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
    });
    const answer = routes[`${method} ${path}`] ?? { status: 404, body: undefined };
    return {
      status: answer.status,
      text: async () => (answer.body === undefined ? '' : JSON.stringify(answer.body)),
    } as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const BASE = 'http://api.test';

const PROFILE = {
  id: 'c-1',
  name: 'Nguyễn Văn A',
  phone: '0903000001',
  agreements: [{ agreement: 'user', version: '1.0', accepted_at: '2026-08-30T01:00:00.000Z' }],
  training_done: true,
  exam_passed: true,
};

describe('signing in (APP-01)', () => {
  it('asks for a code, exchanges it for a token, and keeps the token', async () => {
    const store = fakeStore();
    const { fn, calls } = fakeFetch({
      'POST /auth/collector/request-code': { status: 204 },
      'POST /auth/collector/verify': { status: 200, body: { token: 'tok-abc' } },
      'GET /api/me/profile': { status: 200, body: PROFILE },
    });
    const api = new HttpCollectorApi(BASE, store, () => {}, fn);

    await api.requestSignInCode('0903000001');
    expect(calls[0]?.url).toBe('/auth/collector/request-code');
    expect(calls[0]?.body).toEqual({ phone: '0903000001' });

    await api.signIn('0903000001', '123456');
    expect(calls[1]?.body).toEqual({ phone: '0903000001', code: '123456' });

    // The whole point: the token is in the keystore, not only in memory.
    expect(store.value).toBe('tok-abc');

    // And it is presented on the next collector request.
    await api.profile();
    expect(calls[2]?.headers['authorization']).toBe('Bearer tok-abc');
  });

  it('gives one message for every way a code can be refused', async () => {
    // The route answers a single 401 for a wrong number, a wrong code, an
    // expired code and a code guessed at too often. Telling them apart here
    // would tell an attacker which numbers are enrolled.
    const store = fakeStore();
    const { fn } = fakeFetch({
      'POST /auth/collector/verify': {
        status: 401,
        body: { error: 'credentials', reason: 'credentials' },
      },
    });
    const api = new HttpCollectorApi(BASE, store, () => {}, fn);

    await expect(api.signIn('0903000001', '000000')).rejects.toThrow(
      new ApiError('credentials'),
    );
    // Nothing was stored, and nothing that was there is disturbed.
    expect(store.value).toBeNull();
  });

  it('answers the same way for an enrolled number and an unenrolled one', async () => {
    // `request-code` is 204 whatever the number is, on purpose: a route that
    // answered differently is a way to ask this service which of five hundred
    // numbers belong to collectors. The client must not undo that.
    const { fn } = fakeFetch({ 'POST /auth/collector/request-code': { status: 204 } });
    const api = new HttpCollectorApi(BASE, fakeStore(), () => {}, fn);
    await expect(api.requestSignInCode('0903000001')).resolves.toBeUndefined();
    await expect(api.requestSignInCode('0000000000')).resolves.toBeUndefined();
  });

  it('names the two refusals that are about this service and not about a number', async () => {
    const limited = fakeFetch({ 'POST /auth/collector/request-code': { status: 429 } });
    await expect(
      new HttpCollectorApi(BASE, fakeStore(), () => {}, limited.fn).requestSignInCode('09'),
    ).rejects.toThrow(new ApiError('rate_limited'));

    const nogateway = fakeFetch({ 'POST /auth/collector/request-code': { status: 503 } });
    await expect(
      new HttpCollectorApi(BASE, fakeStore(), () => {}, nogateway.fn).requestSignInCode('09'),
    ).rejects.toThrow(new ApiError('sign_in_unavailable'));
  });
});

describe('a cold start after the app was killed (NFR-03, NFR-04)', () => {
  it('restores the token and refetches every list from the server', async () => {
    const store = fakeStore('tok-stored');
    const { fn, calls } = fakeFetch({
      'GET /api/me/profile': { status: 200, body: PROFILE },
      'GET /api/me/claims': {
        status: 200,
        body: { claims: [{ id: 'cl-1', task_id: 't-1', claimed_at: '2026-08-30T02:00:00.000Z' }] },
      },
      'GET /api/me/devices': {
        status: 200,
        body: {
          devices: [
            { hardware_serial: 'EGO-0007', status: 'active', bound_at: '2026-08-29T02:00:00.000Z' },
          ],
        },
      },
      'GET /api/me/sessions': {
        status: 200,
        body: {
          sessions: [
            {
              id: 's-1',
              task_id: 't-1',
              task_name: 'Bếp',
              scenario: 'home',
              device_serial: 'EGO-0007',
              others_in_frame: true,
              sensitive_info_present: false,
              created_at: '2026-08-30T03:00:00.000Z',
            },
          ],
        },
      },
      'GET /api/me/episodes': {
        status: 200,
        body: {
          episodes: [
            {
              episode_id: 'ego1-20260819-1120',
              recorded_at: '2026-08-19T04:20:00.000Z',
              state: 'not_paid',
              size_bytes: 2684354560,
              reasons: [{ code: 'blurred', label: 'Hình bị mờ' }],
            },
          ],
        },
      },
      'GET /api/me/income': {
        status: 200,
        body: {
          currency: 'VND',
          episodes: [
            {
              episode_id: 'ego1-20260819-1120',
              effective_minutes: '41.5000',
              amount: '49800.0000',
              confirmed: true,
              state: 'on_a_bill',
            },
          ],
        },
      },
    });

    // A brand-new client, as after a process kill: nothing in memory.
    const api = new HttpCollectorApi(BASE, store, () => {}, fn);
    expect(await api.restoreSession()).toBe(true);

    // Every list comes off the wire. There is no local cache to come from.
    expect(await api.myClaims()).toEqual([
      { id: 'cl-1', taskId: 't-1', claimedAt: '2026-08-30T02:00:00.000Z' },
    ]);
    expect(await api.boundDevices()).toEqual([
      { serial: 'EGO-0007', boundAt: '2026-08-29T02:00:00.000Z' },
    ]);
    expect((await api.sessions())[0]?.deviceSerial).toBe('EGO-0007');

    const episodes = await api.episodes();
    // The server's money vocabulary, reduced to APP-23's six states.
    expect(episodes[0]?.state).toBe('review_failed');
    // APP-27: the refusal reason, in the collector's language, from the
    // review standard's own catalogue.
    expect(episodes[0]?.rejectReason).toBe('Hình bị mờ');

    const income = await api.income();
    // Server strings, unchanged. The client rounds nothing and adds nothing.
    expect(income[0]).toEqual({
      episodeId: 'ego1-20260819-1120',
      effectiveMinutes: '41.5000',
      amountVnd: '49800.0000',
      kind: 'confirmed',
      settlementState: 'on_a_bill',
    });

    // Every one of them presented the restored token.
    expect(calls.every((c) => c.headers['authorization'] === 'Bearer tok-stored')).toBe(true);
  });

  it('reports the onboarding a collector has already finished, so the app can resume', async () => {
    // NFR-03/NFR-04 is not met by keeping the token if the app still opens on
    // the registration form — that IS the app having reset, as far as the
    // collector can tell. `App.tsx`'s `startRoute` picks the first unfinished
    // step off exactly these fields, and they are the server's, not the phone's.
    const { fn } = fakeFetch({
      'GET /api/me/profile': {
        status: 200,
        body: {
          ...PROFILE,
          agreements: [
            { agreement: 'user', version: '1.0', accepted_at: '2026-08-30T01:00:00.000Z' },
          ],
          training_done: false,
          exam_passed: false,
        },
      },
    });
    const api = new HttpCollectorApi(BASE, fakeStore('tok-stored'), () => {}, fn);
    expect(await api.restoreSession()).toBe(true);

    const me = await api.profile();
    expect(me?.name).toBe('Nguyễn Văn A');
    // One of six accepted: the app resumes on the agreements screen.
    expect(me?.agreements).toHaveLength(1);
    expect(me?.trainingDone).toBe(false);
    expect(me?.examPassed).toBe(false);
  });

  it('goes to sign-in when there is no stored token, without asking the server', async () => {
    const { fn, calls } = fakeFetch({});
    const api = new HttpCollectorApi(BASE, fakeStore(null), () => {}, fn);
    expect(await api.restoreSession()).toBe(false);
    expect(calls).toEqual([]);
    expect(await api.profile()).toBeNull();
  });
});

describe('a token that has stopped working', () => {
  it('clears it on a 401 and routes to sign-in', async () => {
    const store = fakeStore('tok-dead');
    let signedOut = 0;
    const { fn, calls } = fakeFetch({
      'GET /api/me/claims': { status: 401, body: { error: 'collector token required' } },
    });
    const api = new HttpCollectorApi(BASE, store, () => (signedOut += 1), fn);

    await expect(api.myClaims()).rejects.toThrow(new ApiError('unauthorized'));
    expect(store.value).toBeNull();
    expect(signedOut).toBe(1);

    // Nothing is sent under a token that has been thrown away.
    await api.profile();
    expect(calls).toHaveLength(1);
  });

  it('reports a cold start against a revoked token as signed out', async () => {
    const store = fakeStore('tok-revoked');
    let signedOut = 0;
    const { fn } = fakeFetch({ 'GET /api/me/profile': { status: 401 } });
    const api = new HttpCollectorApi(BASE, store, () => (signedOut += 1), fn);

    expect(await api.restoreSession()).toBe(false);
    expect(store.value).toBeNull();
    expect(signedOut).toBe(1);
  });

  it('KEEPS the token on a 403, which is a scope bug and not a dead session', async () => {
    const store = fakeStore('tok-good');
    let signedOut = 0;
    const { fn } = fakeFetch({
      'GET /api/me/claims': { status: 403, body: { error: 'collector session required' } },
    });
    const api = new HttpCollectorApi(BASE, store, () => (signedOut += 1), fn);

    await expect(api.myClaims()).rejects.toThrow(ApiError);
    expect(store.value).toBe('tok-good');
    expect(signedOut).toBe(0);
  });

  it('KEEPS the token when the phone has no signal', async () => {
    // Losing a thirty-day session because somebody walked into a basement is
    // the failure NFR-03 exists to prevent.
    const store = fakeStore('tok-good');
    let signedOut = 0;
    const fn = (async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    const api = new HttpCollectorApi(BASE, store, () => (signedOut += 1), fn);

    await expect(api.restoreSession()).rejects.toThrow(TypeError);
    expect(store.value).toBe('tok-good');
    expect(signedOut).toBe(0);
  });
});

describe('what the client sends, and what it refuses to', () => {
  it('sends a client-generated id with a claim, so a retry is not a second claim', async () => {
    const store = fakeStore('tok-good');
    const { fn, calls } = fakeFetch({
      'POST /api/me/tasks/t-1/claims': {
        status: 201,
        body: {
          id: 'ignored-by-the-app',
          task_id: 't-1',
          claimed_at: '2026-08-30T04:00:00.000Z',
          replayed: false,
        },
      },
    });
    const api = new HttpCollectorApi(BASE, store, () => {}, fn);
    await api.claimTask('t-1');

    const body = calls[0]?.body as { id?: string };
    expect(body.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // Tapping again presents the SAME id, which is the whole point: the route
    // is `onConflictDoNothing` on it, so a retry after a request that actually
    // landed is a replay and not a second claim. A fresh id per call would make
    // the server's replay contract unreachable from this side.
    await api.claimTask('t-1');
    expect((calls[1]?.body as { id?: string }).id).toBe(body.id);
  });

  it('reuses a session id for the same declaration and never for a changed one', async () => {
    const { fn, calls } = fakeFetch({
      'POST /api/me/sessions': {
        status: 201,
        body: { id: 's-9', collector_id: 'c-1', created_at: '2026-08-30T05:00:00.000Z' },
      },
    });
    const api = new HttpCollectorApi(BASE, fakeStore('tok-good'), () => {}, fn);
    const declaration = {
      taskId: 't-1',
      deviceSerial: 'EGO-0007',
      scenario: 'home',
      othersInFrame: false,
      sensitiveInfo: false,
    } as const;

    await api.createSession(declaration);
    await api.createSession(declaration);
    const first = (calls[0]?.body as { id: string }).id;
    // Two taps on the same form are one session, not two rows for one recording.
    expect((calls[1]?.body as { id: string }).id).toBe(first);

    // A changed APP-17b answer is a different declaration and must not be able
    // to overwrite the first one under its id — the server calls that
    // `session_id_reused` and refuses it.
    await api.createSession({ ...declaration, sensitiveInfo: true });
    expect((calls[2]?.body as { id: string }).id).not.toBe(first);
  });

  it('sends both APP-17b declarations and never the phone on register', async () => {
    const store = fakeStore('tok-good');
    const { fn, calls } = fakeFetch({
      'POST /api/me/register': { status: 201, body: PROFILE },
      'POST /api/me/sessions': {
        status: 201,
        body: { id: 's-9', collector_id: 'c-1', created_at: '2026-08-30T05:00:00.000Z' },
      },
    });
    const api = new HttpCollectorApi(BASE, store, () => {}, fn);

    await api.register('Nguyễn Văn A', '0903000001');
    // The phone is the credential the token already proves, and the route
    // refuses to read it from a body. Sending it would be the one field a
    // collector could use to claim somebody else's number.
    expect(calls[0]?.body).toEqual({ name: 'Nguyễn Văn A' });

    await api.createSession({
      taskId: 't-1',
      deviceSerial: 'EGO-0007',
      scenario: 'home',
      othersInFrame: false,
      sensitiveInfo: true,
    });
    const session = calls[1]?.body as Record<string, unknown>;
    expect(session['others_in_frame']).toBe(false);
    expect(session['sensitive_info_present']).toBe(true);
  });

  it('refuses to pretend an upload started, because there is no route for one', async () => {
    // Path A is out of the pilot: footage reaches the platform on a TF card at
    // an upload centre, and no server route confirms an upload. Resolving here
    // would tell a collector their footage was on its way when nothing moved.
    const api = new HttpCollectorApi(BASE, fakeStore('tok-good'), () => {}, fakeFetch({}).fn);
    await expect(api.confirmUpload('ego1-20260819-1120')).rejects.toThrow(
      new ApiError('upload_not_supported'),
    );
  });

  it('passes a refusal through under the name the server chose for it', async () => {
    const { fn } = fakeFetch({
      'POST /api/me/tasks/t-1/claims': {
        status: 409,
        body: { error: 'refused', constraint: 'task_at_capacity' },
      },
    });
    const api = new HttpCollectorApi(BASE, fakeStore('tok-good'), () => {}, fn);
    await expect(api.claimTask('t-1')).rejects.toThrow(new ApiError('task_at_capacity'));
  });
});
