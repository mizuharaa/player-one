/**
 * The console's view of the API.
 *
 * These types are hand-written against `packages/api/src/review.ts` rather than
 * generated, and that is a temporary state with a named exit: the architecture
 * calls for Zod schemas in `packages/contracts` to emit OpenAPI 3.1 and for CI
 * to generate a typed client from it, so the documentation cannot drift. Until
 * that lands, this file is the seam, and it is one file so the drift has one
 * place to be found.
 *
 * Two things about the transport:
 *
 * **No `Authorization` header anywhere.** The session is two `HttpOnly` cookies
 * (`po_machine`, `po_operator`) set at sign-in. Script cannot read them, which
 * is the point — and it is also what lets a bare `<video src>` and
 * `navigator.sendBeacon` authenticate, neither of which can set a header. Every
 * call here is `credentials: 'same-origin'` and carries nothing else.
 *
 * **Durations are decimal strings, not numbers.** The server sends
 * `measured_duration_seconds` as a string because it is a Postgres `numeric`,
 * and parsing it into a float on the way in would put a second rounding site in
 * the client. The client formats these for display and never does arithmetic
 * that reaches a payment: the server computes money.
 */

/** A Postgres `numeric` as it arrives. Display it; never total it. */
export type Decimal = string;

export type Verdict = 'good' | 'partial' | 'bad';

export interface Flag {
  code: string;
  severity: string;
  detail: string | null;
  blocks_review: boolean;
  suppresses_settlement: boolean;
}

export interface MediaPart {
  index: number;
  url: string;
  bytes: number;
  file: string;
}

export interface Episode {
  episode_id: string;
  session_folder: string;
  ingest_id: string;
  task: { id: string; name: string; price_per_minute: Decimal; currency: string } | null;
  collector: { id: string; display_name: string } | null;
  scenario: { code: string; privacy_risk_level: string } | null;
  declared: {
    others_in_frame: boolean;
    sensitive_info_present: boolean;
    session_origin: string;
  } | null;
  device: { serial: string | null; firmware: string | null };
  measured_duration_seconds: Decimal;
  claimed_duration_seconds: Decimal | null;
  timing: { source: string | null; confidence: string | null };
  frame_rate: number | null;
  recorded_at: string | null;
  flags: Flag[];
  resolver_note: {
    state: string;
    method: string | null;
    confirmed: boolean;
    reason: unknown;
    start_source: unknown;
    start_confidence: unknown;
    candidate_count: unknown;
  };
  media: { role: string | null; parts: MediaPart[] };
}

export interface Claim extends Episode {
  review_id: string;
  lease_expires_at: string | null;
  queue_depth: number;
  session_average_seconds: number | null;
}

/**
 * All three labels are non-null since migration 0018.
 *
 * `label_vi` used to be `string | null` and `label_zh` used to be `string`,
 * which was the wrong way round both times: the columns were equally nullable
 * and the reviewer-facing one was the one the compiler was told to trust. The
 * database now refuses a reason code that is missing either, so this type says
 * what the server can actually send.
 */
export interface ReasonCode {
  code: string;
  category: string;
  label_en: string;
  label_zh: string;
  label_vi: string;
}

export interface RecentReview {
  reviewId: string;
  episodeId: string;
  reviewState: string;
  measured: Decimal;
  effective: Decimal | null;
  reviewedAt: string | null;
  seconds: number | null;
  amount: Decimal | null;
}

export interface VerdictResult {
  episode_id: string;
  decision: Verdict;
  effective_duration_seconds: Decimal | null;
  settlement?: {
    unit_price?: Decimal;
    effective_minutes?: Decimal;
    amount?: Decimal;
  } | null;
  replayed?: boolean;
}

export interface VerdictRequest {
  verdict_id: string;
  episode_id: string;
  decision: Verdict;
  spans: { start_seconds: number; end_seconds: number }[];
  reject_reasons: string[];
  reviewer_note?: string | null;
  time_to_verdict_seconds?: number | null;
}

/**
 * A failed request, carrying the status so callers can act on the ones that
 * mean something specific.
 *
 * 409 is the interesting case, and it is NOT one thing. It is either "somebody
 * else holds this episode now", which the server says by answering
 * `{"error":"reassigned"}`, or a refusal that names itself in `constraint` —
 * the session has no task claim, the disputed settlement was billed, the
 * measured duration is implausible. The two need opposite answers on screen:
 * the first is a lost lease and the reviewer takes the next episode, the second
 * is a sentence about THIS episode and an action on it.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
    /**
     * The refusal this response named, when it named one. Separate from
     * `detail`, which a `reassigned` 409 fills with an English sentence that
     * is not a refusal name and must not be looked up as one.
     */
    readonly constraint?: string,
    /**
     * The parsed error body, when the response had one. A 500 that carries a
     * report — `payout_batch_aborted` is the only one today — is still an
     * error, and the report inside it is still the record of what was sent.
     */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The session is gone. The router sends these back to sign-in. */
  get isUnauthenticated() {
    return this.status === 401 || this.status === 403;
  }

  /**
   * Somebody else holds this episode now.
   *
   * Read off the body, not off the status code. It used to be `status === 409`
   * alone, and that made every named refusal on the verdict path look like an
   * expired lease: a reviewer who tripped `session_claim_missing` was told the
   * claim had gone and to take the next episode, the translated sentence for
   * what actually happened never rendered, and the episode came back to the
   * next reviewer to be refused again.
   */
  get isReassigned() {
    return this.status === 409 && this.message === 'reassigned';
  }

  /**
   * The server refused for a policy reason, not a technical one: remote
   * playback of raw footage is not authorised (brief D11, Part 7.3). A state to
   * explain, never a request to retry.
   */
  get isWithheld() {
    return this.status === 451;
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T | null> {
  const res = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });

  /** 204 is "the queue is empty", which is a state and not an absence of one. */
  if (res.status === 204) return null;

  if (!res.ok) {
    let message = res.statusText;
    let detail: unknown;
    let constraint: string | undefined;
    let body: unknown;
    try {
      body = await res.json();
      const parsed = body as { error?: string; detail?: unknown; constraint?: string };
      if (parsed.error) message = parsed.error;
      /**
       * A back-office 409 carries the constraint that refused it rather than a
       * sentence, so the console can say why in the reader's own language
       * instead of echoing an English string the server chose.
       */
      detail = parsed.detail ?? parsed.constraint;
      constraint = parsed.constraint;
    } catch {
      /* A non-JSON error body is still an error; the status carries it. */
    }
    throw new ApiError(res.status, message, detail, constraint, body);
  }

  return (await res.json()) as T;
}

/* -------------------------------------------------------------------------
   The back office (BO-01 to BO-04). Same transport, same cookies.
   ---------------------------------------------------------------------- */

export interface BoTask {
  id: string;
  name: string;
  type: string | null;
  /** A decimal string. Displayed as written; the server multiplies it. */
  unit_price: Decimal;
  target_effective_duration_s: Decimal | null;
  max_concurrent_claimants: number;
  status: 'draft' | 'published' | 'taken_down';
  claimants: number;
}

export interface BoAgreement {
  agreement: string;
  version: string;
  accepted_at: string;
}

/** The masked view of a collector's current payout account. `null` is the state that matters. */
export interface BoPayoutAccount {
  method: 'WALLET' | 'BANK_ACCOUNT' | 'BANK_CARD';
  verify_status: string;
  phone_masked: string;
}

export interface BoCollector {
  id: string;
  external_ref: string;
  status: 'pending' | 'qualified' | 'suspended';
  exam_result: 'pass' | 'fail' | null;
  exam_decided_at: string | null;
  agreements: BoAgreement[];
  /** `null` means nobody has declared one, which is why this collector cannot be paid. */
  payout_account: BoPayoutAccount | null;
}

/** What the counter declares on a collector's behalf. The full number is sent and not stored. */
export interface BoPayoutDeclaration {
  id: string;
  method: BoPayoutAccount['method'];
  declared_name: string;
  phone?: string;
  bank_code?: string;
  account_no?: string;
}

export interface BoPayoutDeclared {
  id: string;
  replayed: boolean;
  verify_status: string;
  declared_name: string;
  verified_name: string | null;
  account_no_last4: string | null;
  phone_masked: string;
  onboarding_url: string | null;
  reform_url: string | null;
}

export interface BoDevice {
  id: string;
  hardware_serial: string;
  firmware_version: string | null;
  status: 'active' | 'faulty' | 'retired';
  fault_note: string | null;
  bound_collector_id: string | null;
  bound_collector_ref: string | null;
  bound_at: string | null;
  device_type_code: string | null;
}

const send = (path: string, body?: unknown) =>
  call<unknown>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

const patch = (path: string, body: unknown) =>
  call<unknown>(path, { method: 'PATCH', body: JSON.stringify(body) });

/** What BO-01 lets an operator change about a task after it exists. */
export interface BoTaskEdit {
  name?: string;
  type?: string;
  unit_price?: string;
  target_effective_duration_s?: string | null;
  max_concurrent_claimants?: number;
  status?: BoTask['status'];
}

export const backOffice = {
  tasks: () => call<{ tasks: BoTask[] }>('/api/tasks'),
  createTask: (body: {
    id: string;
    name: string;
    type: string;
    unit_price: string;
    target_effective_duration_s?: string;
    max_concurrent_claimants: number;
  }) => send('/api/tasks', body),
  setTask: (id: string, body: BoTaskEdit) => patch(`/api/tasks/${id}`, body),
  setTaskStatus: (id: string, status: BoTask['status']) => patch(`/api/tasks/${id}`, { status }),

  collectors: () =>
    call<{ required_agreements: string[]; collectors: BoCollector[] }>('/api/collectors'),
  createCollector: (body: {
    id: string;
    external_ref: string;
    status?: BoCollector['status'];
  }) => send('/api/collectors', body),
  setCollector: (
    id: string,
    body: {
      status?: BoCollector['status'];
      /** `null` clears a result recorded against the wrong person. */
      exam?: { result: 'pass' | 'fail'; decided_at: string } | null;
      agreements?: BoAgreement[];
    },
  ) => patch(`/api/collectors/${id}`, body),
  /**
   * The counter's payout declaration. On the payout lane by URL, but it is a
   * counter route — any operator session, scoped to their own centre — and the
   * back office is the only screen that calls it, so its client lives here
   * beside the rest of that screen rather than in `payout`, which is finance's.
   */
  declarePayoutAccount: (collectorId: string, body: BoPayoutDeclaration) =>
    call<BoPayoutDeclared>(`/api/payout/collectors/${collectorId}/accounts`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  devices: () =>
    call<{ devices: BoDevice[]; device_types: { id: string; code: string }[] }>('/api/devices'),
  createDevice: (body: {
    id: string;
    device_type_id: string;
    hardware_serial: string;
    firmware_version?: string;
  }) => send('/api/devices', body),
  setDevice: (
    id: string,
    body: {
      status?: BoDevice['status'];
      firmware_version?: string | null;
      fault_note?: string | null;
    },
  ) => patch(`/api/devices/${id}`, body),
  bindDevice: (id: string, collectorId: string) =>
    send(`/api/devices/${id}/bind`, { collector_id: collectorId }),
  unbindDevice: (id: string) => send(`/api/devices/${id}/unbind`),
};

export const api = {
  /** Claims the next episode, or null when there is nothing to review. */
  claimNext: () => call<Claim>('/api/review/claim', { method: 'POST' }),

  /** Metadata without claiming — this is what warms the next video element. */
  episode: (id: string) => call<Episode>(`/api/review/episode/${id}`),

  /** What is next in the queue, without taking it. */
  peek: () => call<Episode>('/api/review/next'),

  reasons: () => call<{ reasons: ReasonCode[] }>('/api/review/reasons'),

  recent: () => call<{ currency: string; reviews: RecentReview[] }>('/api/review/recent'),

  heartbeat: (id: string) => call<unknown>(`/api/review/heartbeat/${id}`, { method: 'POST' }),

  release: (id: string) => call<unknown>(`/api/review/release/${id}`, { method: 'POST' }),

  /**
   * Parks an episode the server refused a verdict on (0017).
   *
   * `held` is not a lane a claim may ask for, so the row stops being served the
   * moment this returns. The reason is mandatory at the server: an episode that
   * leaves every claimable lane and comes back only when a person puts it back
   * has to carry, in words, what the counter is being asked to fix.
   */
  hold: (episodeId: string, reason: string) =>
    call<{ episode_id: string; review_id: string; queue: string }>(
      `/api/review/hold/${episodeId}`,
      { method: 'POST', body: JSON.stringify({ queue: 'held', reason }) },
    ),

  verdict: (body: VerdictRequest) =>
    call<VerdictResult>('/api/review/verdict', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  whoami: () => call<{ actor?: unknown }>('/whoami'),

  /**
   * Releasing a lease when the tab closes.
   *
   * `sendBeacon` is the only thing that reliably runs on unload, and it cannot
   * set headers — which is exactly why the session also travels as cookies.
   * Without this a reviewer who closes the tab locks an episode out of the
   * queue until the lease expires ten minutes later.
   */
  releaseOnUnload: (id: string) => {
    navigator.sendBeacon(`/api/review/release/${id}`);
  },
};

/* -------------------------------------------------------------------------
   Settlement and payout (SET-03 → SET-07, and the payout brief). Same
   transport, same cookies. Every figure below is a server figure rendered as
   received: the console never adds, multiplies or rounds any of them.
   ---------------------------------------------------------------------- */

/** `bills.total` as stored: numeric(14,4) text. */
export interface SettleBill {
  id: string;
  collector_ref: string;
  period_start: string;
  period_end: string;
  currency: string;
  total: Decimal;
  generated_at: string;
  lines: number;
  paid: boolean;
  exceptions: number;
}

export interface GenerateRollover {
  settlements: number;
  collector_refs: string[];
}

export interface GenerateResult {
  period_start: string;
  period_end: string;
  cycle_days: number;
  created: number;
  not_payable: number;
  deferred_to_next_period: GenerateRollover;
  skipped: GenerateRollover;
  /** Parked settlements in the window, on a bill or not. */
  exception: number;
  bills: SettleBill[];
}

export interface SettleLine {
  settlement_id: string;
  episode_id: string;
  review_id: string;
  task: string;
  unit_price: Decimal;
  effective_minutes: Decimal;
  amount: Decimal;
  settlement_state: string;
  reviewed_at: string | null;
}

export interface SettleBillDetail {
  id: string;
  collector_ref: string;
  period_start: string;
  period_end: string;
  currency: string;
  total: Decimal;
  generated_at: string;
  paid: boolean;
  exceptions: number;
  lines: SettleLine[];
}

export type PayoutMethod = 'WALLET' | 'BANK_ACCOUNT' | 'BANK_CARD';
export type VerifyStatus =
  | 'unverified'
  | 'verified'
  | 'name_mismatch'
  | 'no_wallet'
  | 'locked'
  | 'kyc_limit'
  | 'error';
export type AttemptStatus =
  | 'created'
  | 'submitted'
  | 'processing'
  | 'pending_zlp'
  | 'succeeded'
  | 'failed'
  | 'unknown';
export type PayoutMode = 'manual' | 'api';

/** What stands between a bill and a transfer, as `worker/batch.ts` lists it. */
export type PayoutIssue =
  | 'no_account'
  | 'account_unverified'
  | 'over_bank_ceiling'
  | 'under_bank_minimum'
  | 'under_one_dong'
  | 'over_cap'
  | 'risk_hold'
  | 'attempt_open'
  | 'already_paid'
  | 'line_in_exception';

export type RiskBand = 'clear' | 'notice' | 'review' | 'hold';
export type RiskSeverity = 'info' | 'notice' | 'review' | 'hold';

/** The risk seam, §2.3 of the payout brief, exactly as the batch route emits it. */
export interface RiskFlag {
  signalId: string;
  severity: RiskSeverity;
  points: number;
  /** The numbers the sentence is built from. Rendered as a table under it, always. */
  evidence: Record<string, unknown>;
  thresholdVersion: string;
  computedAt: string;
  /**
   * Present only when the summary came through the risk engine's own routes,
   * which render the sentence server-side in every locale. The batch route
   * does not carry it; the console renders from the same templates then.
   */
  sentence?: Partial<Record<string, string>>;
}

export interface RiskSummary {
  subjectType: 'collector' | 'episode' | 'bill' | 'batch';
  subjectId: string;
  score: number;
  band: RiskBand;
  flags: RiskFlag[];
}

export interface PayoutAccountSummary {
  id: string;
  method: PayoutMethod;
  verify_status: VerifyStatus;
  declared_name: string;
  verified_name: string | null;
  phone_masked: string;
}

export interface PayoutAttempt {
  id: string;
  seq: number;
  partner_order_id: string;
  mode: PayoutMode;
  status: AttemptStatus;
  zlp_order_id: string | null;
  zp_trans_id: string | null;
  sub_return_code: number | null;
  manual_reference: string | null;
  poll_count: number;
  last_polled_at: string | null;
  created_at: string;
  settled_at: string | null;
}

/** One bill of a payout batch, `shapeBill` in `payout/routes/payout.ts`. */
export interface PayoutBill {
  id: string;
  collector_id: string;
  collector_ref: string;
  period_start: string;
  period_end: string;
  currency: string;
  total: Decimal;
  /** What a transfer moves: the total rounded down to whole dong. */
  amount_vnd: number;
  lines: number;
  paid: boolean;
  account: PayoutAccountSummary | null;
  attempt: PayoutAttempt | null;
  risk: RiskSummary;
  issues: PayoutIssue[];
}

export interface PayoutBatch {
  period_start: string;
  period_end: string;
  mode: PayoutMode;
  bills: PayoutBill[];
}

/** The preflight, `Preflight` in `payout/worker/batch.ts`, plus the bills it names. */
export interface PayoutPreflight {
  period_start: string;
  period_end: string;
  mode: PayoutMode;
  bills: number;
  payable: number;
  total_vnd: number;
  required_vnd: number;
  balance_vnd: number | null;
  shortfall_vnd: number;
  ok: boolean;
  /** The server's own sentence, in English. Shown as what the server said, beside the translated summary. */
  refusal: string | null;
  counts: Record<PayoutIssue, number>;
  risk_bands: Record<RiskBand, number>;
  cap_vnd: number | null;
  bank_ceiling_vnd: number;
  exceptions: PayoutBill[];
}

/** One period of a collector's income, server-computed, `/collectors/:id/income`. */
export interface IncomePeriod {
  bill_id: string | null;
  period_start: string;
  period_end: string;
  valid_minutes: Decimal;
  gross: Decimal;
  withheld: Decimal;
  net: Decimal;
  status: 'pending_review' | 'approved' | 'paid' | 'on_hold';
}

export interface PayoutEvent {
  kind: string;
  evidence: Record<string, unknown>;
  occurred_at: string;
}

export interface PayoutAttemptDetail {
  id: string;
  billId: string;
  partnerOrderId: string;
  attemptSeq: number;
  amountVnd: number;
  mode: PayoutMode;
  status: AttemptStatus;
  zlpOrderId: string | null;
  zpTransId: string | null;
  subReturnCode: number | null;
  manualReference: string | null;
  lastPolledAt: string | null;
  pollCount: number;
  createdAt: string;
  settledAt: string | null;
  events: PayoutEvent[];
}

export interface PayResult {
  bill_id: string;
  attempt_id: string;
  partner_order_id: string;
  status: AttemptStatus;
  zlp_order_id?: string | null;
  sub_return_code?: number | null;
  amount_vnd?: number;
  manual_reference?: string;
  settled_at?: string | null;
}

/**
 * What one server-side batch run reports: `BatchRun` in
 * `payout/worker/batch.ts`. The batch is a loop on the server — preflight at
 * entry, one transfer at a time with a pause between, stop at the first
 * refusal, a ticket when the whole batch is refused. The console never
 * iterates `/pay` itself; it asks for the run and renders this.
 */
export interface BatchRun {
  period_start: string;
  period_end: string;
  mode: PayoutMode;
  preflight: Omit<PayoutPreflight, 'exceptions' | 'mode'>;
  sent: { bill_id: string; attempt_id: string; partner_order_id: string; status: AttemptStatus; result: string }[];
  /** Every bill the run did not send, with the constraint name the catalogue maps to a sentence. */
  refused: { bill_id: string; collector_ref: string; constraint: string }[];
  /** The bill id the run stopped at, or null. Its constraint is in `refused`. */
  stopped_at: string | null;
  tickets: { kind: string; bill_id: string | null; evidence: unknown; occurred_at: string }[];
}

/**
 * Whether this session may pay.
 *
 * The identity route answers `operator` for every counter session and does
 * not carry the finance role, and `index.ts` is not this console's to change.
 * Until it does, the question is put to a finance-gated route in a form it
 * refuses before touching anything: an id that is not a UUID. The role check
 * is a pre-handler, so somebody without the role is turned away with 403
 * before the handler runs, and somebody with it reaches the handler and is
 * told 400 for the bad id. Neither path reads a bill, writes a row or audits
 * anything. The screens treat `unknown` as read-only.
 */
export type FinanceRole = 'finance' | 'operator' | 'unknown';

const batchPath = (start: string) => `/api/payout/batches/${encodeURIComponent(start)}`;

export const settle = {
  bills: (periodStart: string) =>
    call<{ period_start: string; period_end: string; bills: SettleBill[] }>(
      `/api/settle/bills?period_start=${encodeURIComponent(periodStart)}`,
    ),
  /** SET-07: bill every pending settlement of the period. Idempotent on the server. */
  generate: (periodStart: string) =>
    call<GenerateResult>('/api/settle/bills', {
      method: 'POST',
      body: JSON.stringify({ period_start: periodStart }),
    }),
  bill: (id: string) => call<SettleBillDetail>(`/api/settle/bills/${id}`),
  /** The per-line CSV (SET-06). A plain link: the cookies go with it. */
  linesCsvUrl: (periodStart: string) =>
    `/api/settle/export.csv?period_start=${encodeURIComponent(periodStart)}`,
};

export const payout = {
  batch: (periodStart: string) => call<PayoutBatch>(batchPath(periodStart)),
  preflight: (periodStart: string) =>
    call<PayoutPreflight>(`${batchPath(periodStart)}/preflight`, { method: 'POST' }),
  income: (collectorId: string) =>
    call<{ collector_id: string; currency: string; periods: IncomePeriod[] }>(
      `/api/payout/collectors/${collectorId}/income`,
    ),
  attempt: (id: string) => call<PayoutAttemptDetail>(`/api/payout/attempts/${id}`),
  /** The API rail, one bill. Refused with `payout_mode_manual` in the pilot's default mode. */
  pay: (billId: string) => call<PayResult>(`/api/payout/bills/${billId}/pay`, { method: 'POST' }),
  /**
   * The API rail, the whole period, as ONE server-side run of `runBatch`.
   *
   * Served by `POST /api/payout/batches/:period/run` on feat/payout-domain
   * (finance, audited, one run per period at a time — a second caller is
   * refused 409 `payout_batch_running`). A server without it answers 404 and
   * the screen says so.
   */
  runBatch: async (
    periodStart: string,
  ): Promise<(BatchRun & { aborted: boolean }) | null> => {
    try {
      const run = await call<BatchRun>(`${batchPath(periodStart)}/run`, { method: 'POST' });
      if (run === null) return null;
      return { ...run, aborted: false };
    } catch (err) {
      /**
       * A run may throw after earlier transfers committed. Only the named
       * aborted response is turned back into a report, and only when every
       * report collection is present; every other error keeps its old path.
       */
      const body =
        err instanceof ApiError && err.status === 500
          ? (err.body as Partial<BatchRun> & { error?: string } | undefined)
          : undefined;
      if (
        body?.error === 'payout_batch_aborted' &&
        Array.isArray(body.sent) &&
        Array.isArray(body.refused) &&
        Array.isArray(body.tickets) &&
        body.preflight !== undefined
      ) {
        return { ...(body as BatchRun), aborted: true };
      }
      throw err;
    }
  },
  /**
   * The manual rail. The reference is the transfer the operator made; the
   * amount is retyped by the operator and checked by the database against
   * the bill, never computed here.
   */
  markPaid: (billId: string, body: { manual_reference: string; amount_vnd: number }) =>
    call<PayResult>(`/api/payout/bills/${billId}/mark-paid`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  resolve: (
    attemptId: string,
    body: { outcome: 'succeeded' | 'failed'; reason: string; zp_trans_id?: string },
  ) =>
    call<{ attempt_id: string; status: AttemptStatus; zp_trans_id: string | null; settled_at: string | null }>(
      `/api/payout/attempts/${attemptId}/resolve`,
      { method: 'POST', body: JSON.stringify(body) },
    ),
  /** The hashed payout CSV (finance). A plain link, so the browser downloads it with the cookies. */
  exportUrl: (periodStart: string) => `/api/payout/export/${encodeURIComponent(periodStart)}`,

  financeRole: async (): Promise<FinanceRole> => {
    const res = await fetch('/api/payout/attempts/probe/resolve', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (res.status === 400) return 'finance';
    if (res.status === 403) return 'operator';
    if (res.status === 401) throw new ApiError(401, res.statusText);
    return 'unknown';
  },
};

/* -------------------------------------------------------------------------
   The risk engine's own routes (Agent C). The summary on a payout bill comes
   from the batch route above; these add the hold trail and the one action an
   operator takes — clearing a hold with a typed reason. A server without the
   engine answers 404 here, and the screen says so rather than hiding the
   controls.
   ---------------------------------------------------------------------- */

export type ClearVerdict = 'false_positive' | 'accepted' | 'resolved';

export interface RiskHold {
  hold_id: string;
  raised_by_flag: string;
  raised_at: string;
  signal_ids: string[];
  cleared_at: string | null;
  cleared_by: string | null;
  clear_reason: string | null;
  clear_verdict: ClearVerdict | null;
}

/** A flag as the engine's routes shape it: snake_case, with the sentence in every locale. */
interface ShapedFlag {
  signal_id: string;
  severity: RiskSeverity;
  points: number;
  threshold_version: string;
  computed_at: string;
  evidence: Record<string, unknown>;
  sentence: Record<string, string>;
}

interface ShapedSummary {
  subject_type: RiskSummary['subjectType'];
  subject_id: string;
  score: number;
  band: RiskBand;
  evaluated_at: string | null;
  flags: ShapedFlag[];
}

/** One shape in the console, whichever route the summary came from. */
const camelSummary = (s: ShapedSummary): RiskSummary & { evaluatedAt: string | null } => ({
  subjectType: s.subject_type,
  subjectId: s.subject_id,
  score: s.score,
  band: s.band,
  evaluatedAt: s.evaluated_at,
  flags: s.flags.map((f) => ({
    signalId: f.signal_id,
    severity: f.severity,
    points: f.points,
    evidence: f.evidence,
    thresholdVersion: f.threshold_version,
    computedAt: f.computed_at,
    sentence: f.sentence,
  })),
});

export const risk = {
  billSummary: async (billId: string) => {
    const s = await call<ShapedSummary>(`/api/risk/summary/bill/${billId}`);
    return s === null ? null : camelSummary(s);
  },
  holds: (billId: string) =>
    call<{ bill_id: string; held: boolean; history: RiskHold[] }>(`/api/risk/holds/${billId}`),
  clearHold: (billId: string, body: { reason: string; verdict: ClearVerdict }) =>
    call<{ bill_id: string; cleared_hold: string; held: boolean }>(`/api/risk/holds/${billId}/clear`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
