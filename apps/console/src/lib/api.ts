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

export interface ReasonCode {
  code: string;
  category: string;
  label_en: string;
  label_zh: string;
  label_vi: string | null;
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
 * 409 on a verdict is the interesting case: it means the lease was lost, either
 * because it expired or because an operator reassigned the episode. That is not
 * an error to retry — the reviewer's marks are now about somebody else's
 * episode — so the screen has to say so and fetch a new one.
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly detail?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** The session is gone. The router sends these back to sign-in. */
  get isUnauthenticated() {
    return this.status === 401 || this.status === 403;
  }

  /** Somebody else holds this episode now. */
  get isReassigned() {
    return this.status === 409;
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
    try {
      const body = (await res.json()) as { error?: string; detail?: unknown; constraint?: string };
      if (body.error) message = body.error;
      /**
       * A back-office 409 carries the constraint that refused it rather than a
       * sentence, so the console can say why in the reader's own language
       * instead of echoing an English string the server chose.
       */
      detail = body.detail ?? body.constraint;
    } catch {
      /* A non-JSON error body is still an error; the status carries it. */
    }
    throw new ApiError(res.status, message, detail);
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

export interface BoCollector {
  id: string;
  external_ref: string;
  status: 'pending' | 'qualified' | 'suspended';
  exam_result: 'pass' | 'fail' | null;
  exam_decided_at: string | null;
  agreements: BoAgreement[];
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
