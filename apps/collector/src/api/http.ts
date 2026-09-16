import type { TokenStore } from './token-store.ts';

/**
 * A `TokenStore` that forgets when the process does.
 *
 * The default for the Zalo state, and fail-closed on purpose: a deep link that
 * arrives after a restart finds nothing to match and is dropped, so the
 * collector taps the button again. Dropping a good ticket is a retry;
 * redeeming a bad one is somebody else's account. `App.tsx` passes the
 * keystore, which is what makes the restart case work in the shipped app.
 */
const memoryStore = (): TokenStore => {
  let held: string | null = null;
  return {
    get: async () => held,
    set: async (value) => {
      held = value;
    },
    clear: async () => {
      held = null;
    },
  };
};
import {
  DELIVERY_STATES,
  type DeliveryOutcome,
  type DeliveryPlan,
  type DeliveryRecord,
  type DeliveryState,
  type FilePlan,
} from '@playerone/delivery';
import {
  ApiError,
  NOTIFICATION_KINDS,
  SCENARIOS,
  type AgreementId,
  type BoundDevice,
  type Claim,
  type CollectionSession,
  type CollectorApi,
  type CollectorNotificationRow,
  type CollectorProfile,
  type EpisodeState,
  type EpisodeUpload,
  type IncomeCycle,
  type IncomeEntry,
  type PayoutDestination,
  type Scenario,
  type SessionInput,
  type Task,
} from './types.ts';

/**
 * The real client: the collector app against the platform's own routes.
 *
 * ---------------------------------------------------------------------------
 * THE TOKEN, AND THE ONE STATUS THAT THROWS IT AWAY
 *
 * A collector token is good for thirty days and is revoked by bumping
 * `collectors.token_epoch`, which every collector request checks
 * (`packages/api/src/index.ts`). So there are exactly three answers this client
 * has to tell apart, and it gets them wrong in three different ways if it
 * conflates any two:
 *
 *   - **401** — the token is dead: expired, revoked, or the collector row is
 *     gone. The token is cleared and the app goes back to sign-in. This is the
 *     ONLY status that clears anything.
 *   - **403** — the token is fine and the route is not a collector's. That is
 *     a bug in this app, not an expired session, and signing the collector out
 *     over it would hide the bug behind a login screen.
 *   - **a network error** — the phone has no signal. The token is KEPT.
 *     Throwing a session away because somebody walked into a basement is
 *     exactly the failure NFR-03 exists to prevent.
 *
 * ---------------------------------------------------------------------------
 * THE TWO SIGN-IN ROUTES ANSWER DELIBERATELY VAGUELY, AND THIS CLIENT KEEPS
 * THEM VAGUE
 *
 * `POST /auth/collector/request-code` answers 204 for an enrolled number and an
 * unenrolled one alike, with an identical empty body and a latency floor, so
 * that this service cannot be used to ask which of five hundred numbers belong
 * to collectors. `POST /auth/collector/verify` answers one 401 for a wrong
 * number, a wrong code, an expired code and a code guessed at too often.
 *
 * A client that turned either of those into a specific message would undo the
 * whole design. `requestSignInCode` therefore resolves the same way for every
 * number, and `signIn` throws one `ApiError('credentials')` for every failure.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CLIENT NEVER DOES
 *
 * It sends no duration and no amount, and computes neither: effective minutes
 * and money arrive as server strings, already rounded by `quantise`, the single
 * rounding site in the platform. It starts no upload except from
 * `registerDelivery`, which runs from the confirmation a collector taps through
 * (APP-25). Its only cache is the delivery resume record in `upload/delivery.ts`
 * — every screen refetches, because the server is the record.
 */
export class HttpCollectorApi implements CollectorApi {
  /** The token in memory, so every request does not hit the keystore. */
  private token: string | null = null;
  private disposed = false;
  private readonly lifetime = new AbortController();
  private tokenWrite: Promise<void> = Promise.resolve();

  private active(): void {
    if (this.disposed) throw new ApiError('unauthorized');
  }

  private persist(write: () => Promise<void>): Promise<void> {
    const next = this.tokenWrite.catch(() => {}).then(write);
    this.tokenWrite = next;
    return next;
  }

  dispose(): void {
    this.disposed = true;
    this.token = null;
    this.ids.clear();
    this.lifetime.abort();
  }

  async signOut(): Promise<void> {
    this.dispose();
    // A keystore write already in flight must finish BEFORE the clear.
    await this.persist(() => this.tokens.clear());
  }

  /**
   * The client-generated ids already handed to a claim and a session, by what
   * they are an id FOR.
   *
   * This is what makes the server's replay contract work from this side, and
   * without it that contract is decoration. `POST /api/me/tasks/:id/claims` and
   * `POST /api/me/sessions` are `onConflictDoNothing` on the id the phone
   * sends, then a read-back that tells a replay from an id reused for something
   * else — so a retry has to present the SAME id. Generating a fresh one per
   * call turns "the request timed out, tap again" into a second row: a second
   * claim, or two collection sessions for one recording.
   *
   * Claims live for the client lifetime; session ids are cleared when a new
   * creation attempt begins. Within that attempt, retries keep their identity.
   *
   * ponytail: an in-memory Map, not a persisted outbox. It
   * covers the case that actually happens — the collector taps again on the
   * screen they are standing on. A retry after the app is killed gets a new id
   * and is refused by the server's own guards (`task_claims_capacity`,
   * `already_claimed`); a persisted outbox is the Path A upload queue's problem
   * and Path A is out of the pilot.
   */
  private readonly ids = new Map<string, string>();

  private idFor(key: string): string {
    const held = this.ids.get(key);
    if (held !== undefined) return held;
    const fresh = uuid();
    this.ids.set(key, fresh);
    return fresh;
  }

  constructor(
    private readonly baseUrl: string,
    private readonly tokens: TokenStore,
    /** Called when a 401 kills the session, so the app can show sign-in. */
    private readonly onUnauthorized: () => void,
    /**
     * ponytail: injectable ONLY so `test/http-api.test.ts` can drive this
     * against a fake without a server. `App.tsx` passes nothing. It is not a
     * strategy, not configuration, and there is no second implementation.
     */
    private readonly fetchFn: typeof fetch = fetch,
    /**
     * Where the `state` of a Zalo sign-in in flight is kept, so the ticket that
     * comes back can be proved to belong to the attempt this phone started.
     *
     * It has to OUTLIVE THE PROCESS: Android can kill the app while the person
     * is on Zalo's permission screen and then relaunch it on the deep link, so
     * an in-memory value would be gone at exactly the moment it is needed.
     * `App.tsx` passes the keystore.
     *
     * The in-memory default is fail-closed and deliberate: a caller that
     * supplies none can still start a sign-in, and a deep link arriving after
     * a restart finds nothing to match and is dropped. The collector taps the
     * button again. Dropping a good ticket is a retry; redeeming a bad one is
     * somebody else's account.
     */
    private readonly zaloState: TokenStore = memoryStore(),
  ) {}

  // -- the wire ------------------------------------------------------------

  private async body(res: Response): Promise<unknown> {
    this.active();
    if (res.status === 204) return undefined;
    const text = await res.text().catch(() => { this.active(); throw new ApiError('server_unreachable'); });
    this.active();
    if (text === '') return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  private async send(path: string, method: string, payload?: unknown): Promise<Response> {
    this.active();
    const headers: Record<string, string> = {};
    if (this.token !== null) headers['authorization'] = `Bearer ${this.token}`;
    if (payload !== undefined) headers['content-type'] = 'application/json';
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const response = await this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body,
      signal: AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(method === 'GET' ? 20_000 : 60_000)]),
    }).catch(() => { this.active(); throw new ApiError('server_unreachable'); });
    this.active();
    return response;
  }

  /**
   * Every `/api/me` call. The refusal translation is a pass-through on purpose:
   * `collector-app.ts` already maps its database constraints onto
   * collector-facing names before they leave the server, so nothing internal
   * reaches here to be leaked.
   */
  private async req(method: string, path: string, payload?: unknown): Promise<unknown> {
    const res = await this.send(path, method, payload);
    this.active();

    if (res.status === 401) {
      try { await this.signOut(); } finally { this.onUnauthorized(); }
      throw new ApiError('unauthorized');
    }

    const parsed = await this.body(res);
    this.active();
    if (res.status >= 200 && res.status < 300) return parsed;

    const constraint = (parsed as { constraint?: unknown } | undefined)?.constraint;
    const sentence = (parsed as { message?: unknown } | undefined)?.message;
    const code = typeof constraint === 'string' ? constraint : res.status === 400 ? 'invalid_request' : res.status === 429 ? 'rate_limited' : 'server_error';
    throw Object.assign(new ApiError(code), { sentence: typeof sentence === 'string' ? sentence : undefined });
  }

  // -- sign in (APP-01) ----------------------------------------------------

  async requestSignInCode(phone: string): Promise<void | { demo_code: string }> {
    const res = await this.send('/auth/collector/request-code', 'POST', { phone });
    if (res.status === 429) throw new ApiError('rate_limited');
    // No gateway configured on this deployment. Nothing the collector can do,
    // but telling them "try again" for ever would be a lie.
    if (res.status === 503) throw new ApiError('sign_in_unavailable');
    // A 400 is about the shape of the request, never about the number.
    if (res.status === 400) throw new ApiError('invalid_request');
    if (res.status < 200 || res.status >= 300) throw new ApiError('server_error');
    /**
     * A demonstration server echoes that one number's code so nobody has to
     * read it out of a log. A successful answer without a 200 carrying exactly
     * six digits is treated as the ordinary 204 — a malformed body is not an error
     * worth showing a collector, it just means there is no code to fill in.
     */
    if (res.status === 200) {
      const code = (await this.body(res) as { demo_code?: unknown } | undefined)?.demo_code;
      if (typeof code === 'string' && /^\d{6}$/.test(code)) return { demo_code: code };
    }
    // Successful answers reveal nothing about whether the number is enrolled.
  }

  async signIn(phone: string, code: string): Promise<void> {
    const res = await this.send('/auth/collector/verify', 'POST', { phone, code });
    // NOT `req`: a failed sign-in is not an expired session, and there is no
    // stored token here to clear.
    if (res.status === 401) throw new ApiError('credentials');
    if (res.status === 429) throw new ApiError('rate_limited');
    if (res.status < 200 || res.status >= 300) throw new ApiError('server_error');

    const token = (await this.body(res)) as { token?: unknown } | undefined;
    this.active();
    if (typeof token?.token !== 'string') throw new ApiError('server_error');
    const value = token.token;
    this.token = value;
    await this.persist(() => this.tokens.set(value));
    this.active();
  }

  // -- sign in with Zalo (APP-01, owner's decision 2026-09-16) -------------

  async startZaloSignIn(options?: { probeOnly?: boolean }): Promise<{ url: string; state: string }> {
    const res = await this.send('/auth/collector/zalo/start', 'POST');
    if (res.status === 429) throw new ApiError('rate_limited');
    // No Zalo app on this deployment. The screen hides the button on this
    // rather than showing a control that cannot work.
    if (res.status === 503) throw new ApiError('zalo_not_configured');
    if (res.status < 200 || res.status >= 300) throw new ApiError('server_error');
    const body = (await this.body(res)) as { url?: unknown; state?: unknown } | undefined;
    this.active();
    if (typeof body?.url !== 'string' || typeof body.state !== 'string') {
      throw new ApiError('server_error');
    }
    /**
     * Remembered BEFORE the browser opens, because the browser may never come
     * back to this process. Written before the URL is returned so the caller
     * cannot open Zalo on a state that was not stored.
     */
    if (!options?.probeOnly) await this.persistState(body.state);
    return { url: body.url, state: body.state };
  }

  /**
   * Trade the deep link's ticket for the token — but only if the link belongs
   * to the sign-in this phone started.
   *
   * The `state` comes back beside the ticket and is compared, byte for byte,
   * against the one stored by `startZaloSignIn`. Without this the app redeemed
   * ANY `playerone://signed-in?ticket=…` the OS handed it: a second app
   * claiming the scheme could sign the collector into an attacker's account,
   * which is login-CSRF and is what both audits of `4a32929` found.
   *
   * Throws `ApiError('zalo_state_unknown')` on a mismatch or a missing stored
   * state, and does NOT clear the stored value — a forged link must not be
   * able to make the real one that arrives a second later fail too.
   */
  async signInWithTicket(ticket: string, state: string): Promise<void> {
    const expected = await this.zaloState.get();
    this.active();
    if (expected === null || state === '' || state !== expected) {
      throw new ApiError('zalo_state_unknown');
    }
    // Matched, so this attempt is over however the exchange goes: a ticket is
    // single-use, and leaving the state behind would let a replay of the same
    // link pass this check again.
    await this.persistState(null);
    const res = await this.send('/auth/collector/ticket', 'POST', { ticket });
    // NOT `req`: a refused ticket is not an expired session, and there is no
    // stored token here to clear.
    if (res.status === 401) throw new ApiError('zalo_ticket_spent');
    if (res.status === 429) throw new ApiError('rate_limited');
    if (res.status < 200 || res.status >= 300) throw new ApiError('server_error');

    const token = (await this.body(res)) as { token?: unknown } | undefined;
    this.active();
    if (typeof token?.token !== 'string') throw new ApiError('server_error');
    const value = token.token;
    this.token = value;
    await this.persist(() => this.tokens.set(value));
    this.active();
  }

  /** Serialised with the token writes, for the reason `persist` gives. */
  private persistState(state: string | null): Promise<void> {
    return this.persist(() => (state === null ? this.zaloState.clear() : this.zaloState.set(state)));
  }

  // -- the demo bypass (owner's request 2026-09-16) ------------------------

  /**
   * One key for the ordinary collector token. Same token handling as the two
   * routes above -- NOT `req`, because a refused key is not an expired session
   * and there is no stored token to clear.
   *
   * A 404 means this deployment has no bypass, and is exactly what a server
   * without the route answers; the sheet says so rather than offering another
   * try.
   */
  async signInWithDemoKey(key: string): Promise<void> {
    const res = await this.send('/auth/collector/demo', 'POST', { key });
    if (res.status === 404) throw new ApiError('demo_unavailable');
    if (res.status === 401) throw new ApiError('credentials');
    if (res.status === 429) throw new ApiError('rate_limited');
    if (res.status === 503) throw new ApiError('demo_collector_absent');
    if (res.status < 200 || res.status >= 300) throw new ApiError('server_error');

    const token = (await this.body(res)) as { token?: unknown } | undefined;
    this.active();
    if (typeof token?.token !== 'string') throw new ApiError('server_error');
    const value = token.token;
    this.token = value;
    await this.persist(() => this.tokens.set(value));
    this.active();
  }

  async restoreSession(): Promise<boolean> {
    this.active();
    const stored = await this.tokens.get();
    this.active();
    if (stored === null) return false;
    this.token = stored;
    try {
      await this.req('GET', '/api/me/profile');
      this.active();
      return true;
    } catch (err) {
      // A 401 has already cleared the token on the way through `req`. Anything
      // else — no signal, a 500 — keeps it and rethrows, because neither is
      // evidence that this collector has to sign in again.
      if (err instanceof ApiError && err.code === 'unauthorized') return false;
      throw err;
    }
  }

  // -- the collector (APP-01 to APP-05) ------------------------------------

  async profile(): Promise<CollectorProfile | null> {
    this.active();
    if (this.token === null) return null;
    return toProfile(await this.req('GET', '/api/me/profile'));
  }

  /**
   * The phone is not sent, and the route would not read it if it were.
   *
   * It is the credential the token already proves, and `POST /api/me/register`
   * refuses to take it from a body for exactly that reason: writing a phone
   * from a body would let one collector claim another's number. The parameter
   * stays on the signature because the mock and `Register.tsx` still have one.
   */
  async register(name: string, _phone: string): Promise<CollectorProfile> {
    return toProfile(await this.req('POST', '/api/me/register', { name }));
  }

  async acceptAgreements(
    acceptances: { agreementId: AgreementId; version: string }[],
  ): Promise<CollectorProfile> {
    return toProfile(
      await this.req('POST', '/api/me/agreements', {
        agreements: acceptances.map((a) => ({ agreement: a.agreementId, version: a.version })),
      }),
    );
  }

  async completeTraining(): Promise<CollectorProfile> {
    return toProfile(await this.req('POST', '/api/me/training'));
  }

  async submitExam(answers: boolean[]): Promise<{ passed: boolean }> {
    const res = (await this.req('POST', '/api/me/exam', { answers })) as { passed?: unknown };
    return { passed: res.passed === true };
  }

  // -- the task hall (APP-08, APP-10) --------------------------------------

  async tasks(): Promise<Task[]> {
    const res = (await this.req('GET', '/api/me/tasks')) as { tasks?: RawTask[] };
    return (res.tasks ?? []).map(toTask);
  }

  async task(id: string): Promise<Task> {
    return toTask((await this.req('GET', `/api/me/tasks/${id}`)) as RawTask);
  }

  async claimTask(taskId: string): Promise<Claim> {
    // One id per task: a collector claims a given task once, so a retry after a
    // timeout is a replay of that claim and not a second one.
    const id = this.idFor(`claim:${taskId}`);
    const res = (await this.req('POST', `/api/me/tasks/${taskId}/claims`, { id })) as {
      id: string;
      task_id: string;
      claimed_at: string;
    };
    return { id: res.id, taskId: res.task_id, claimedAt: String(res.claimed_at) };
  }

  async myClaims(): Promise<Claim[]> {
    const res = (await this.req('GET', '/api/me/claims')) as {
      claims?: { id: string; task_id: string; task_name: string; claimed_at: string }[];
    };
    return (res.claims ?? []).map((c) => ({
      id: c.id,
      taskId: c.task_id,
      taskName: c.task_name,
      claimedAt: String(c.claimed_at),
    }));
  }

  // -- devices (APP-14, APP-18) --------------------------------------------

  async boundDevices(): Promise<BoundDevice[]> {
    const res = (await this.req('GET', '/api/me/devices')) as {
      devices?: { hardware_serial: string; bound_at: string; status: string }[];
    };
    return (res.devices ?? []).map((d) => ({
      serial: d.hardware_serial,
      boundAt: String(d.bound_at),
      status: d.status ?? null,
    }));
  }

  async bindDevice(serial: string): Promise<BoundDevice> {
    const res = (await this.req('POST', '/api/me/devices', { hardware_serial: serial })) as {
      hardware_serial: string;
      bound_at: string;
    };
    return { serial: res.hardware_serial, boundAt: String(res.bound_at), status: null };
  }

  // -- sessions (APP-16, APP-17b) ------------------------------------------

  beginSessionAttempt(): void {
    for (const key of this.ids.keys()) {
      if (key.startsWith('session:')) this.ids.delete(key);
    }
  }

  async createSession(input: SessionInput): Promise<CollectionSession> {
    /**
     * Keyed on the whole declaration, because that is what a replay is a replay
     * OF. Re-tapping the same form retries the same session; changing an
     * APP-17b answer and tapping again is a different declaration and gets a
     * different id, which is what stops a replay silently rewriting what the
     * collector declared — the server refuses that as `session_id_reused`.
     */
    const id = this.idFor(
      `session:${input.taskId}|${input.deviceSerial}|${input.scenario}|${String(
        input.othersInFrame,
      )}|${String(input.sensitiveInfo)}`,
    );
    const res = (await this.req('POST', '/api/me/sessions', {
      id,
      task_id: input.taskId,
      device_serial: input.deviceSerial,
      scenario: input.scenario,
      // APP-17b: both declarations, always sent, never defaulted. The route
      // takes `z.boolean()` and not `.default(false)`, so a missing one is a
      // 400 rather than quietly becoming the safe-looking answer.
      others_in_frame: input.othersInFrame,
      sensitive_info_present: input.sensitiveInfo,
    })) as { id: string; collector_id: string; created_at: string };
    return {
      ...input,
      id: res.id,
      collectorId: res.collector_id,
      createdAt: String(res.created_at),
    };
  }

  async sessions(): Promise<CollectionSession[]> {
    const res = (await this.req('GET', '/api/me/sessions')) as { sessions?: RawSession[] };
    return (res.sessions ?? []).map((s) => ({
      id: s.id,
      taskId: s.task_id,
      deviceSerial: s.device_serial ?? '',
      scenario: asScenario(s.scenario),
      othersInFrame: s.others_in_frame,
      sensitiveInfo: s.sensitive_info_present,
      /**
       * ponytail: empty, and correct. `GET /api/me/sessions` is scoped to the
       * token and does not repeat the collector id in the rows — there is no id
       * in the request for it to echo. No screen reads this field.
       */
      collectorId: '',
      createdAt: String(s.created_at),
    }));
  }

  // -- uploads and income (APP-23, APP-27, APP-33) -------------------------

  async episodes(): Promise<EpisodeUpload[]> {
    const res = (await this.req('GET', '/api/me/episodes')) as { episodes?: RawEpisode[] };
    return (res.episodes ?? []).map((e) => ({
      episodeId: e.episode_id,
      /**
       * ponytail: empty. `/api/me/episodes` carries no collection session id —
       * an episode is tied to a session through the counter's ingest, and the
       * collector's own view of it never needed one. No screen reads it.
       */
      sessionId: '',
      sizeBytes: toSizeBytes(e.size_bytes),
      state: toEpisodeState(e.state),
      /**
       * APP-27. Already Vietnamese: the server reads
       * `coalesce(label_vi, label_en)` off `review_reason_codes`, the review
       * standard's own catalogue. These cannot live in `i18n.ts` — they are
       * rows PaXini maintains, not strings this repository owns.
       */
      rejectReason:
        e.reasons !== undefined && e.reasons.length > 0
          ? e.reasons.map((r) => r.label).join(', ')
          : undefined,
    }));
  }

  // -- Path A: a recorded session, from the phone to the cloud -------------

  /**
   * UPL-01/APP-26. Register an UNMEASURED delivery, and get the plan back.
   *
   * The unmeasured shape is the one this app can honestly fill: a directory
   * name, and every file in it with its size and digest. The measured shape —
   * a finished `EpisodeRecord` — is Path C's, posted by a console on a machine
   * with ffprobe. The server discriminates on the absence of `episode`, so
   * there is no tag to get wrong; there is simply nothing in this request that
   * could carry a duration, a stream count or an amount.
   *
   * The same id twice is a replay and is answered with the plan re-signed
   * against what the store holds now. That is how a retry over a dropped
   * connection stays one delivery, and it is also how an expired signed URL is
   * refreshed (`upload/delivery.ts`).
   */
  async registerDelivery(record: DeliveryRecord): Promise<DeliveryPlan> {
    const res = (await this.req('POST', '/api/me/uploads', {
      id: record.uploadId,
      collection_session_id: record.collectionSessionId,
      session_basename: record.sessionBasename,
      files: record.files.map((f) => ({
        relative_path: f.relativePath,
        bytes: f.bytes,
        sha256: f.sha256,
      })),
    })) as RawDelivery;
    return toDeliveryPlan(record.uploadId, res);
  }

  /**
   * The plan and the state, read off the server.
   *
   * Two jobs, one route, because the server answers both from the same row:
   * resume (what does the cloud not hold yet) and progress (what did the
   * platform make of the bytes). Nothing is inferred here from what this phone
   * did — `done` and the missing parts are the object store's answer.
   */
  async deliveryPlan(uploadId: string): Promise<DeliveryPlan> {
    const res = (await this.req('GET', `/api/me/uploads/${encodeURIComponent(uploadId)}`)) as RawDelivery;
    return toDeliveryPlan(uploadId, res);
  }

  /**
   * UPL-04/05. Ask the server to read every object back, re-hash it, and — if
   * the bytes are what the phone said they were — measure the session.
   *
   * No body: the server already knows the inventory it planned. The verdict
   * comes back as a state and, when there is one, the server's own reason.
   */
  async completeDelivery(uploadId: string): Promise<DeliveryOutcome> {
    const res = (await this.req(
      'POST',
      `/api/me/uploads/${encodeURIComponent(uploadId)}/complete`,
    )) as RawDelivery;
    const plan = toDeliveryPlan(uploadId, res);
    return {
      state: plan.state,
      episodeId: plan.episodeId,
      heldReason: plan.heldReason,
      failedReason: plan.failedReason,
    };
  }

  async income(): Promise<IncomeEntry[]> {
    const res = (await this.req('GET', '/api/me/income')) as { episodes?: RawIncome[]; simulation?: boolean };
    return (res.episodes ?? []).map((e) => ({
      episodeId: e.episode_id,
      // Server strings, unchanged. Nothing here adds, divides or rounds money.
      effectiveMinutes: e.effective_minutes,
      amountVnd: e.amount,
      // APP-34: `confirmed` is the server's word for "a human has decided".
      kind: e.confirmed === true ? 'confirmed' : 'estimated',
      settlementState: e.state,
      ...(res.simulation === undefined ? {} : { simulation: res.simulation === true }),
    }));
  }

  /**
   * §14.1. Server strings, copied across — nothing here adds or rounds.
   *
   * ponytail: a second GET of the same route rather than a cached half of
   * `income()`. The income screen makes two calls where one would do; caching
   * across methods would be state this client does not otherwise keep, and at
   * pilot scale the extra read is a few tens of rows. Fold them together when
   * one screen's latency actually says so.
   */
  async incomeCycle(): Promise<IncomeCycle | null> {
    const res = (await this.req('GET', '/api/me/income')) as { cycle?: RawCycle; simulation?: boolean };
    const c = res.cycle;
    if (c === undefined) return null;
    return {
      label: c.label,
      ...(res.simulation === undefined ? {} : { simulation: res.simulation === true }),
      confirmedVnd: c.confirmedVnd,
      estimatedVnd: c.estimatedVnd,
      totalVnd: c.totalVnd,
    };
  }

  /**
   * §14.2. A status this app does not know is a server it does not know, and
   * the honest answer is `payout.unknown` rather than the nearest neighbour —
   * the same rule `toDeliveryState` follows, and for a stronger reason: the
   * neighbour of "refused" is "awaiting", and telling a collector to wait for
   * a verification that already failed is the lie this screen exists to avoid.
   */
  async payout(): Promise<PayoutDestination | null> {
    const res = (await this.req('GET', '/api/me/payout')) as RawPayout;
    const status = PAYOUT_STATUSES.find((s) => s === res.status);
    if (status === undefined) return null;
    return { channel: 'zalopay', status, masked: res.masked ?? null,
      ...(res.verification_simulation === undefined ? {} : { verification_simulation: res.verification_simulation === true }),
      ...(res.simulation === undefined ? {} : { simulation: res.simulation === true }),
      ...(res.payment ? { payment: res.payment } : {}) };
  }

  // -- the inbox -----------------------------------------------------------

  /**
   * One page, newest first.
   *
   * ponytail: no paging. The route takes `after` and answers `next`, and this
   * client asks for neither: a pilot collector accumulates a notification per
   * upload, verdict, bill and payment, which is tens of rows over twenty
   * devices, and the route's default page is thirty. Follow `next` the first
   * time an inbox actually runs off the end of one — the cursor is already there
   * and tested.
   *
   * A value in `payload` that is not a string or null is dropped rather than
   * coerced. The server writes ids and stored figures as strings; anything else
   * arriving would be a shape this app has no sentence for, and `String(…)` on
   * it would put "[object Object]" in front of a collector.
   */
  async notifications(): Promise<CollectorNotificationRow[]> {
    const res = (await this.req('GET', '/api/me/notifications')) as {
      notifications?: RawNotification[];
    };
    return (res.notifications ?? []).map((n) => ({
      id: n.id,
      kind: NOTIFICATION_KINDS.find((k) => k === n.kind) ?? 'unknown',
      payload: Object.fromEntries(
        Object.entries(n.payload ?? {}).filter(
          (e): e is [string, string | null] => typeof e[1] === 'string' || e[1] === null,
        ),
      ),
      createdAt: String(n.created_at),
      readAt: n.read_at === null || n.read_at === undefined ? null : String(n.read_at),
    }));
  }

  async markNotificationRead(id: string): Promise<void> {
    await this.req('POST', `/api/me/notifications/${encodeURIComponent(id)}/read`, {});
  }
}

const PAYOUT_STATUSES = ['verified', 'awaiting', 'none'] as const;

// ---------------------------------------------------------------------------
// Wire shapes and the mapping onto the app's types

interface RawTask {
  id: string;
  name: string;
  type: string | null;
  unit_price: string;
  target_effective_duration_s: string | null;
  collected_effective_s: string;
  max_concurrent_claimants: number;
  claimants: number;
  currency: string;
  published: boolean;
  claimed_by_me: boolean;
  claimable: boolean;
  remaining_slots: number;
}

interface RawSession {
  id: string;
  task_id: string;
  scenario: string;
  device_serial: string | null;
  others_in_frame: boolean;
  sensitive_info_present: boolean;
  created_at: string;
}

interface RawNotification {
  id: string;
  kind: string;
  payload?: Record<string, unknown>;
  created_at: string;
  read_at?: string | null;
}

interface RawEpisode {
  episode_id: string;
  state: string;
  size_bytes?: number | string | null;
  reasons?: { code: string; label: string }[];
}

interface RawIncome {
  episode_id: string;
  effective_minutes: string | null;
  amount: string | null;
  confirmed: boolean;
  state: string;
}

/** §14.1 on the wire. camelCase, because the spec names these fields itself. */
interface RawCycle {
  label: string;
  confirmedVnd: string;
  estimatedVnd: string;
  totalVnd: string;
}

interface RawPayout {
  verification_simulation?: boolean;
  simulation?: boolean;
  payment?: { reference: string; amount_vnd: number };
  status?: string;
  masked?: string | null;
}

/**
 * `FilePlan` off `packages/api/src/collector-upload.ts`, and the answer every
 * one of the three delivery routes carries.
 *
 * Every field is optional here because a plan for a file the store already
 * holds carries `done` and nothing else, and a settled delivery carries no
 * files at all. Treating an absent `parts` as "no parts to send" is the
 * server's own meaning, not a guess.
 */
interface RawFilePlan {
  relative_path: string;
  done?: boolean;
  put_url?: string;
  parts?: { part_number: number; start: number; end: number; url: string }[];
}

interface RawDelivery {
  state?: string;
  episode_id?: string | null;
  held_reason?: string | null;
  failed_reason?: string | null;
  files?: RawFilePlan[];
}

/**
 * A state this app does not know is a server it does not know, and the honest
 * answer is to refuse rather than to pick the nearest neighbour.
 *
 * `toEpisodeState` below falls back to `under_review` for an unknown episode
 * state, and that is right there: the list is APP-23's and an unreviewed
 * episode read as "somebody has it" is conservative. It would be wrong here. A
 * delivery state decides whether a collector is told their footage is safe, so
 * a fallback would eventually mean showing `ingested` for a word the server
 * added meaning "we lost it".
 */
const toDeliveryState = (state: unknown): DeliveryState => {
  const known = DELIVERY_STATES.find((s) => s === state);
  if (known === undefined) throw new ApiError('server_error');
  return known;
};

const toDeliveryPlan = (uploadId: string, res: RawDelivery | undefined): DeliveryPlan => ({
  uploadId,
  state: toDeliveryState(res?.state),
  episodeId: res?.episode_id ?? null,
  // The server's own words, carried through untouched. `i18n.ts` has a
  // sentence for the reasons it can raise and shows the raw name for anything
  // it does not, because a reason a collector was not paid on is not the place
  // for this app to guess.
  heldReason: res?.held_reason ?? null,
  failedReason: res?.failed_reason ?? null,
  files: (res?.files ?? []).map(
    (f): FilePlan => ({
      relativePath: f.relative_path,
      done: f.done === true,
      putUrl: f.put_url ?? null,
      parts: (f.parts ?? []).map((p) => ({
        partNumber: p.part_number,
        start: p.start,
        end: p.end,
        url: p.url,
      })),
    }),
  ),
});

/** Preserve an actual zero without treating missing or malformed metadata as zero. */
const toSizeBytes = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const bytes = Number(value);
  return Number.isFinite(bytes) && bytes >= 0 ? bytes : null;
};

const toProfile = (raw: unknown): CollectorProfile => {
  const p = raw as {
    id: string;
    name: string | null;
    phone: string | null;
    agreements?: { agreement: string; version: string; accepted_at: string }[];
    training_done: boolean;
    exam_passed: boolean;
    onboarded?: boolean;
  };
  return {
    id: p.id,
    // Both are nullable on `collectors`: a collector enrolled at a counter has
    // a row before they have ever typed a name.
    name: p.name ?? '',
    phone: p.phone ?? '',
    agreements: (p.agreements ?? []).map((a) => ({
      agreementId: a.agreement as AgreementId,
      version: a.version,
      acceptedAt: String(a.accepted_at),
    })),
    trainingDone: p.training_done,
    examPassed: p.exam_passed,
    /**
     * Absent means onboarded, so a phone on this build talking to a server
     * from before open sign-up behaves exactly as it did: the claim screen
     * offers Accept and the server's own answer decides. Defaulting the other
     * way would tell every collector on an older deployment to visit a centre
     * they have already been to.
     */
    onboarded: p.onboarded ?? true,
  };
};

const asScenario = (code: string): Scenario => {
  const found = SCENARIOS.find((s) => s === code);
  if (found === undefined) throw new ApiError('unsupported_scenario');
  return found;
};

/**
 * Seconds to minutes, for a progress bar and a target.
 *
 * This is NOT the client computing a payment figure. Every payable number still
 * arrives as a server string through `IncomeEntry`; these two are the task
 * hall's "how far along is this task", which the server serves in seconds
 * because `tasks.target_effective_duration_s` is a seconds column.
 */
const minutes = (seconds: string | null): number => Math.round(Number(seconds ?? '0') / 60);

const toTask = (raw: RawTask): Task => ({
  id: raw.id,
  title: raw.name,
  scenario: null,
  type: raw.type,
  currency: raw.currency,
  published: raw.published === true,
  claimable: raw.claimable === true,
  claimedByMe: raw.claimed_by_me === true,
  remainingSlots: raw.remaining_slots,
  unitPriceVndPerMinute: raw.unit_price,
  targetMinutes: minutes(raw.target_effective_duration_s),
  claimedMinutes: minutes(raw.collected_effective_s),
  maxClaimants: raw.max_concurrent_claimants,
  claimants: raw.claimants,
  /**
   * ponytail: APP-09 IS NOT BUILT ON THE SERVER and these three have no source.
   *
   * `tasks` holds id, name, type, unit_price, target, max claimants and status
   * — no instructions, no privacy notice, no payment rule. `collector-app.ts`
   * declines to add nullable columns for them because a task shipped with an
   * empty privacy notice is worse than a task the app knows is incomplete:
   * that copy is text legal has to approve, and PaXini owes it.
   *
   * Empty rather than invented. `TaskDetail.tsx` prints `detail.notSupplied`
   * for an empty one, which is true, instead of placeholder prose a collector
   * would read as the real instructions.
   */
  instructions: '',
  privacyNotice: '',
  paymentRule: '',
});

/**
 * The server's ten collector-facing states onto APP-23's six.
 *
 * `me.ts`'s `CollectorState` answers "where is my money", which is a longer
 * story than "where is my footage": six of its values are all one thing to this
 * screen — the review passed and the money is somewhere in settlement.
 *
 * `pending_upload` and `uploading` are absent on purpose and cannot appear: the
 * platform only knows episodes that have been ingested at an upload centre, so
 * every episode it can name is at least `uploaded`.
 */
const EPISODE_STATE_OF: Record<string, EpisodeState> = {
  uploaded: 'uploaded',
  being_rechecked: 'under_review',
  approved: 'review_passed',
  on_a_bill: 'review_passed',
  action_needed: 'review_passed',
  waiting_on_us: 'review_passed',
  on_hold: 'review_passed',
  paid: 'review_passed',
  not_paid: 'review_failed',
  cannot_be_paid: 'review_failed',
};

// `unknown` is the server's own "nobody has mapped this", and the honest
// rendering of it is "being looked at", not "failed".
const toEpisodeState = (state: string): EpisodeState => EPISODE_STATE_OF[state] ?? 'under_review';

/**
 * A client-generated id for the two routes that take one.
 *
 * `POST /api/me/tasks/:id/claims` and `POST /api/me/sessions` follow the
 * counter's replay contract — `onConflictDoNothing` on this id, then a read-back
 * that tells a replay from an id reused for something else — so the id is what
 * makes a retry over a bad connection idempotent rather than a second claim.
 *
 * ponytail: `Math.random` where `crypto.randomUUID` is absent, because React
 * Native core ships no WebCrypto. This id is a replay key and not a secret, and
 * a collision costs a refusal (`claim_id_reused`) rather than a wrong payment.
 * Swap it for `expo-crypto` at the first build that has a native project.
 */
export const uuid = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (ch) => {
    const n = Number(ch);
    return (n ^ (Math.floor(Math.random() * 256) & (15 >> (n / 4)))).toString(16);
  });
};
