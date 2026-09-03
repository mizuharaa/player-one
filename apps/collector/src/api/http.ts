import type { TokenStore } from './token-store.ts';
import {
  ApiError,
  type AgreementId,
  type BoundDevice,
  type Claim,
  type CollectionSession,
  type CollectorApi,
  type CollectorProfile,
  type EpisodeState,
  type EpisodeUpload,
  type IncomeEntry,
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
 * `confirmUpload`, which a collector taps. It has no queue, no retry policy and
 * no offline cache — the server is the record, and every screen refetches.
 */
export class HttpCollectorApi implements CollectorApi {
  /** The token in memory, so every request does not hit the keystore. */
  private token: string | null = null;

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
   * ponytail: a Map for the life of the client, not a persisted outbox. It
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
  ) {}

  // -- the wire ------------------------------------------------------------

  private async body(res: Response): Promise<unknown> {
    if (res.status === 204) return undefined;
    const text = await res.text();
    if (text === '') return undefined;
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  }

  private async send(path: string, method: string, payload?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.token !== null) headers['authorization'] = `Bearer ${this.token}`;
    if (payload !== undefined) headers['content-type'] = 'application/json';
    return this.fetchFn(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
    });
  }

  /**
   * Every `/api/me` call. The refusal translation is a pass-through on purpose:
   * `collector-app.ts` already maps its database constraints onto
   * collector-facing names before they leave the server, so nothing internal
   * reaches here to be leaked.
   */
  private async req(method: string, path: string, payload?: unknown): Promise<unknown> {
    const res = await this.send(path, method, payload);

    if (res.status === 401) {
      this.token = null;
      await this.tokens.clear();
      this.onUnauthorized();
      throw new ApiError('unauthorized');
    }

    const parsed = await this.body(res);
    if (res.status >= 200 && res.status < 300) return parsed;

    const constraint = (parsed as { constraint?: unknown } | undefined)?.constraint;
    if (typeof constraint === 'string') throw new ApiError(constraint);
    if (res.status === 400) throw new ApiError('invalid_request');
    if (res.status === 429) throw new ApiError('rate_limited');
    throw new ApiError('server_error');
  }

  // -- sign in (APP-01) ----------------------------------------------------

  async requestSignInCode(phone: string): Promise<void> {
    const res = await this.send('/auth/collector/request-code', 'POST', { phone });
    if (res.status === 429) throw new ApiError('rate_limited');
    // No gateway configured on this deployment. Nothing the collector can do,
    // but telling them "try again" for ever would be a lie.
    if (res.status === 503) throw new ApiError('sign_in_unavailable');
    // A 400 is about the shape of the request, never about the number.
    if (res.status === 400) throw new ApiError('invalid_request');
    // 204, and every other answer, is the same answer. Say nothing more.
  }

  async signIn(phone: string, code: string): Promise<void> {
    const res = await this.send('/auth/collector/verify', 'POST', { phone, code });
    // NOT `req`: a failed sign-in is not an expired session, and there is no
    // stored token here to clear.
    if (res.status === 401) throw new ApiError('credentials');
    if (res.status === 429) throw new ApiError('rate_limited');
    if (res.status < 200 || res.status >= 300) throw new ApiError('server_error');

    const token = (await this.body(res)) as { token?: unknown } | undefined;
    if (typeof token?.token !== 'string') throw new ApiError('server_error');
    this.token = token.token;
    await this.tokens.set(token.token);
  }

  async restoreSession(): Promise<boolean> {
    const stored = await this.tokens.get();
    if (stored === null) return false;
    this.token = stored;
    try {
      await this.req('GET', '/api/me/profile');
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
      claims?: { id: string; task_id: string; claimed_at: string }[];
    };
    return (res.claims ?? []).map((c) => ({
      id: c.id,
      taskId: c.task_id,
      claimedAt: String(c.claimed_at),
    }));
  }

  // -- devices (APP-14, APP-18) --------------------------------------------

  async boundDevices(): Promise<BoundDevice[]> {
    const res = (await this.req('GET', '/api/me/devices')) as {
      devices?: { hardware_serial: string; bound_at: string }[];
    };
    return (res.devices ?? []).map((d) => ({
      serial: d.hardware_serial,
      boundAt: String(d.bound_at),
    }));
  }

  async bindDevice(serial: string): Promise<BoundDevice> {
    const res = (await this.req('POST', '/api/me/devices', { hardware_serial: serial })) as {
      hardware_serial: string;
      bound_at: string;
    };
    return { serial: res.hardware_serial, boundAt: String(res.bound_at) };
  }

  // -- sessions (APP-16, APP-17b) ------------------------------------------

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
      sizeBytes: Number(e.size_bytes ?? 0),
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

  /**
   * ponytail: THERE IS NO SERVER ROUTE FOR THIS, and it is not an oversight.
   *
   * Path A upload — the phone pulling media off the camera and pushing it to
   * the cloud — is out of the pilot: footage reaches the platform on the TF
   * card, at an upload centre. So no route exists to confirm an upload to, and
   * inventing a local success here would show a collector that their footage
   * was on its way when nothing had moved.
   *
   * It is also unreachable in practice. `Uploads.tsx` only offers the button
   * for `pending_upload`, and `/api/me/episodes` cannot return that state: the
   * server only knows episodes that have already been ingested. It throws
   * rather than resolving so that if the button ever does appear, it says so.
   */
  async confirmUpload(_episodeId: string): Promise<EpisodeUpload> {
    throw new ApiError('upload_not_supported');
  }

  async income(): Promise<IncomeEntry[]> {
    const res = (await this.req('GET', '/api/me/income')) as { episodes?: RawIncome[] };
    return (res.episodes ?? []).map((e) => ({
      episodeId: e.episode_id,
      // Server strings, unchanged. Nothing here adds, divides or rounds money.
      effectiveMinutes: e.effective_minutes,
      amountVnd: e.amount,
      // APP-34: `confirmed` is the server's word for "a human has decided".
      kind: e.confirmed === true ? 'confirmed' : 'estimated',
      settlementState: e.state,
    }));
  }
}

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

interface RawEpisode {
  episode_id: string;
  state: string;
  size_bytes: number | string | null;
  reasons?: { code: string; label: string }[];
}

interface RawIncome {
  episode_id: string;
  effective_minutes: string | null;
  amount: string | null;
  confirmed: boolean;
  state: string;
}

const toProfile = (raw: unknown): CollectorProfile => {
  const p = raw as {
    id: string;
    name: string | null;
    phone: string | null;
    agreements?: { agreement: string; version: string; accepted_at: string }[];
    training_done: boolean;
    exam_passed: boolean;
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
  };
};

const SCENARIOS: readonly Scenario[] = ['home', 'office', 'shop', 'warehouse'];

const asScenario = (code: string): Scenario =>
  SCENARIOS.find((s) => s === code) ?? 'home';

/**
 * ponytail: A TASK HAS NO SCENARIO COLUMN, so this is a guess with a fallback.
 *
 * `tasks.type` is `'home_cooking'` where the app's `Scenario` union is
 * `home | office | shop | warehouse`, and `collector-app.ts` says outright that
 * scenarios are keyed to a SESSION rather than to a task. Matching the four
 * codes as a substring gets `home_cooking` right and anything unforeseen wrong,
 * in the safe direction of the most common pilot scenario.
 *
 * This matters beyond display: `SessionCreate.tsx` declares the session's
 * scenario from the task's. What a task's scenario IS — a column, a per-session
 * choice the collector makes, or neither — is a product decision nobody has
 * made, and guessing it in code is not this client's to do. Left as the
 * narrowest guess with the loudest comment.
 */
const scenarioOfType = (type: string | null): Scenario =>
  SCENARIOS.find((s) => type !== null && type.includes(s)) ?? 'home';

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
  scenario: scenarioOfType(raw.type),
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
const uuid = (): string => {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (ch) => {
    const n = Number(ch);
    return (n ^ (Math.floor(Math.random() * 256) & (15 >> (n / 4)))).toString(16);
  });
};
