/**
 * The collector app's view of the platform, and the seam the mock fills.
 *
 * Two invariants from the engineering brief are load-bearing in these shapes
 * and deliberately impossible to violate through them:
 *
 * - **The client never sends a duration or an amount.** No input type here
 *   carries minutes or money. Effective minutes and amounts arrive from the
 *   server as strings, already computed and already rounded (`quantise` in
 *   `packages/api/src/money.ts` is the only rounding site in the system).
 * - **The app never starts or stops recording.** There is no method for it,
 *   here or on `DeviceTransport`. Recording is the device's own affair.
 */

/**
 * A refusal both implementations throw, carrying a code and never a sentence.
 *
 * The code is a name a screen looks up in `i18n.ts`; the server's own refusal
 * constraints (`packages/api/src/collector-app.ts`'s `CLAIM_REFUSALS`) are
 * already collector-facing names rather than database constraint names, so the
 * HTTP client passes them straight through.
 *
 * It lives here rather than in `mock.ts` because both the mock and the HTTP
 * client throw it, and a screen that catches one must catch the other.
 */
export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * APP-02's six agreements, versioned. Acceptance names the version it saw.
 *
 * These six identifiers are NOT the app's to choose. They are the closed set
 * in the server's `collector_agreements_name_check` CHECK constraint
 * (`packages/store/src/schema.ts`), which is what actually rejects an unknown
 * agreement; the app is the client of that constraint. Keep them byte-equal —
 * `test/mock-api.test.ts` pins the list, so a rename here fails loudly instead
 * of failing at the first real POST.
 */
export const AGREEMENTS = [
  { id: 'user', version: '1.0' },
  { id: 'privacy', version: '1.0' },
  { id: 'data_collection', version: '1.0' },
  { id: 'commercial_use', version: '1.0' },
  { id: 'manual_review', version: '1.0' },
  { id: 'offline_settlement', version: '1.0' },
] as const;

export type AgreementId = (typeof AGREEMENTS)[number]['id'];

export interface AgreementAcceptance {
  agreementId: AgreementId;
  /** The version the collector was shown, not "whatever is current now". */
  version: string;
  acceptedAt: string;
}

export interface CollectorProfile {
  id: string;
  name: string;
  phone: string;
  agreements: AgreementAcceptance[];
  trainingDone: boolean;
  /** APP-05: no exam pass, no task claiming. The server enforces it too. */
  examPassed: boolean;
}

export type Scenario = 'home' | 'office' | 'shop' | 'warehouse';

export interface Task {
  id: string;
  title: string;
  scenario: Scenario;
  /** Display only. The server computes every payment. */
  unitPriceVndPerMinute: string;
  targetMinutes: number;
  claimedMinutes: number;
  maxClaimants: number;
  claimants: number;
  instructions: string;
  privacyNotice: string;
  paymentRule: string;
}

export interface Claim {
  id: string;
  taskId: string;
  claimedAt: string;
}

export interface BoundDevice {
  serial: string;
  boundAt: string;
}

/** APP-17b: both declarations are required booleans, never defaulted. */
export interface SessionInput {
  taskId: string;
  deviceSerial: string;
  scenario: Scenario;
  othersInFrame: boolean;
  sensitiveInfo: boolean;
}

export interface CollectionSession extends SessionInput {
  id: string;
  collectorId: string;
  createdAt: string;
}

/** APP-23's six states, verbatim. */
export const EPISODE_STATES = [
  'pending_upload',
  'uploading',
  'uploaded',
  'under_review',
  'review_passed',
  'review_failed',
] as const;

export type EpisodeState = (typeof EPISODE_STATES)[number];

export interface EpisodeUpload {
  episodeId: string;
  sessionId: string;
  sizeBytes: number;
  state: EpisodeState;
  /** APP-27: a failed review names its reason, in the collector's language. */
  rejectReason?: string;
}

export interface IncomeEntry {
  episodeId: string;
  /** Server-computed. `null` until the server has anything to say. */
  effectiveMinutes: string | null;
  amountVnd: string | null;
  /** APP-34: estimated is never presented as confirmed. */
  kind: 'estimated' | 'confirmed';
  settlementState: string | null;
}

/**
 * The typed client every screen talks to. `MockCollectorApi` implements it for
 * development and the screen tests; `HttpCollectorApi` implements it against
 * the platform's `/api/me/*` routes.
 */
export interface CollectorApi {
  /**
   * APP-01. Ask the platform to send a one-time code to this number.
   *
   * Resolves whatever the number is. `POST /auth/collector/request-code`
   * answers 204 for an enrolled number and an unenrolled one alike, on
   * purpose — a route that answered differently would be a way to ask which of
   * five hundred numbers belong to collectors — and this app must not undo
   * that by telling the collector which one they typed.
   */
  requestSignInCode(phone: string): Promise<void>;
  /**
   * APP-01. Exchange the code for a thirty-day token, and keep the token.
   *
   * Throws `ApiError('credentials')` for a wrong number, a wrong code, an
   * expired code and a code guessed at too often — one refusal, because
   * `POST /auth/collector/verify` answers one 401 for all four.
   */
  signIn(phone: string, code: string): Promise<void>;
  /**
   * NFR-03/NFR-04. Cold start: is there a stored token, and does it still work?
   *
   * True means the app opens where the collector left it. False means the
   * sign-in screen. Throws only when the server could not be reached at all —
   * no signal is not a signed-out session, and must not clear the token.
   */
  restoreSession(): Promise<boolean>;
  profile(): Promise<CollectorProfile | null>;
  register(name: string, phone: string): Promise<CollectorProfile>;
  /** APP-02: all six at once, each acceptance naming the version shown. */
  acceptAgreements(
    acceptances: { agreementId: AgreementId; version: string }[],
  ): Promise<CollectorProfile>;
  completeTraining(): Promise<CollectorProfile>;
  submitExam(answers: boolean[]): Promise<{ passed: boolean }>;
  tasks(): Promise<Task[]>;
  task(id: string): Promise<Task>;
  claimTask(taskId: string): Promise<Claim>;
  myClaims(): Promise<Claim[]>;
  boundDevices(): Promise<BoundDevice[]>;
  bindDevice(serial: string): Promise<BoundDevice>;
  createSession(input: SessionInput): Promise<CollectionSession>;
  sessions(): Promise<CollectionSession[]>;
  episodes(): Promise<EpisodeUpload[]>;
  /**
   * APP-25: the ONLY code path that starts an upload. Called from the
   * confirmation step the collector explicitly taps through — never from an
   * effect, a timer, or a network-state listener.
   */
  confirmUpload(episodeId: string): Promise<EpisodeUpload>;
  income(): Promise<IncomeEntry[]>;
}
