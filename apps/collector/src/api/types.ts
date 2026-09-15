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

import type { DeliveryApi } from '@playerone/delivery';

/**
 * A refusal both implementations throw, carrying a code and never a sentence.
 *
 * The code is a name a screen looks up in `i18n.ts`; the server's own refusal
 * constraints (`packages/api/src/collector-app.ts`'s `CLAIM_REFUSALS`) are
 * already collector-facing names rather than database constraint names, so the
 * HTTP client passes them straight through.
 *
 * It is declared in `@playerone/delivery` and re-exported here, which is the
 * whole of the change that sharing the state machine cost this app. `mock.ts`,
 * `http.ts` and every screen still import it from this file, and they still
 * catch the same class the state machine throws — which is the property that
 * matters and which two ApiError classes would have quietly broken.
 */
export { ApiError } from '@playerone/delivery';

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

/** Existing codes documented by POST /api/me/sessions; server validates availability. */
export const SCENARIOS = ['home', 'office', 'shop', 'warehouse'] as const;
export type Scenario = (typeof SCENARIOS)[number];

export interface Task {
  id: string;
  title: string;
  /** Task type is not a session scenario. Null means not supplied. */
  scenario: Scenario | null;
  type?: string | null;
  published: boolean;
  claimable: boolean;
  claimedByMe: boolean;
  remainingSlots: number;
  currency: string;
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
  taskName?: string;
}

export interface BoundDevice {
  serial: string;
  boundAt: string;
  /** Bind response has no state; the authoritative device list supplies it. */
  status: string | null;
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
  /** Missing or invalid server size is unknown, never a measured zero. */
  sizeBytes: number | null;
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
 * SPEC §14.1. The current settlement cycle, already rounded by the server.
 *
 * Four strings, printed as they arrive. The app is forbidden from computing
 * any of them: a cycle total the client adds up is a second arithmetic that
 * can disagree with the bill, which is the one thing a money screen must not
 * do.
 */
export interface IncomeCycle {
  /** The server's own words, e.g. `17/08 – 23/08`. */
  label: string;
  confirmedVnd: string;
  estimatedVnd: string;
  totalVnd: string;
}

/** SPEC §14.2. Where the collector gets paid, and how far verification got. */
export interface PayoutDestination {
  simulation?: boolean;
  payment?: { reference: string; amount_vnd: number };
  channel: 'zalopay';
  status: 'verified' | 'awaiting' | 'none';
  /** The server's own redaction, e.g. `•••• 5678`. Never a full identifier. */
  masked: string | null;
}

/**
 * The thirteen kinds `collector_notifications_kind_check` admits, in the order
 * `docs/notifications.md` lists them.
 *
 * The same closed set as the database CHECK and the `NotificationKind` union in
 * `packages/api/src/notifications.ts`, and this copy exists because the app is
 * shipped separately from the server: a signed APK on a phone meets whatever
 * server is deployed that week. So a kind this list does not know is the
 * ordinary case of an old app against a new server, not a bug — `'unknown'` is
 * where it lands, and the inbox prints `notif.update` for it rather than a blank
 * row or a crash. Same rule as `toEpisodeState` and `toDeliveryState`.
 */
export const NOTIFICATION_KINDS = [
  'upload_verified',
  'upload_ingested',
  'upload_held',
  'upload_failed',
  'review_passed',
  'review_partial',
  'review_failed',
  'bill_issued',
  'payment_recorded',
  'payout_account_verified',
  'payout_account_refused',
  'task_published',
  'claim_accepted',
] as const;

export type NotificationKind = (typeof NOTIFICATION_KINDS)[number] | 'unknown';

/**
 * One row of `GET /api/me/notifications`.
 *
 * `payload` carries ids and the server's stored figures as the strings they are
 * stored as. The app inserts them into a sentence and does no arithmetic on
 * them — APP-34 on a new surface — so nothing here is a number.
 */
export interface CollectorNotificationRow {
  id: string;
  kind: NotificationKind;
  payload: Record<string, string | null>;
  /** ISO 8601, as every other timestamp in this app arrives. */
  createdAt: string;
  readAt: string | null;
}

/**
 * The typed client every screen talks to. `MockCollectorApi` implements it for
 * development and the screen tests; `HttpCollectorApi` implements it against
 * the platform's `/api/me/*` routes.
 *
 * The three Path A methods come in from `DeliveryApi` (`upload/delivery.ts`)
 * rather than being written out again here, because the state machine that
 * drives them is defined against that interface and the two must not drift.
 *
 * APP-25 is not a method any more and could not be: an upload now starts with
 * a directory the collector picked out of the system picker, which is as
 * explicit as a confirmation gets, and it still runs only from the panel they
 * tap through — never from an effect, a timer, or a network-state listener.
 * What replaced `confirmUpload` is in `upload/delivery.ts`; what `confirmUpload`
 * was is in the history, and it never moved a byte.
 */
export interface CollectorApi extends DeliveryApi {
  /**
   * APP-01. Ask the platform to send a one-time code to this number.
   *
   * Resolves whatever the number is. `POST /auth/collector/request-code`
   * answers 204 for an enrolled number and an unenrolled one alike, on
   * purpose — a route that answered differently would be a way to ask which of
   * five hundred numbers belong to collectors — and this app must not undo
   * that by telling the collector which one they typed.
   */
  /**
   * Ask for a sign-in code.
   *
   * Resolves with `{ demo_code }` only when the server is configured to echo
   * that one number's code for a demonstration, and with nothing otherwise. The
   * app reacts to what the server sent rather than to a build-time flag, so a
   * normal server gives a normal app and there is nothing to leave switched on
   * in a shipped APK.
   */
  requestSignInCode(phone: string): Promise<void | { demo_code: string }>;
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
  /** Local-device sign-out, not server token revocation. Retire this client. */
  signOut(): Promise<void>;
  /** Stop accepting results from this client without deleting its stored token. */
  dispose(): void;
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
  beginSessionAttempt(): void;
  createSession(input: SessionInput): Promise<CollectionSession>;
  sessions(): Promise<CollectionSession[]>;
  episodes(): Promise<EpisodeUpload[]>;
  income(): Promise<IncomeEntry[]>;
  /**
   * §14.1. `null` when the server has not sent a cycle, which the screen
   * renders as `home.cycleUnavailable` — never as a figure the app worked out.
   */
  incomeCycle(): Promise<IncomeCycle | null>;
  /** §14.2. `null` when the server has not sent a status, rendered `payout.unknown`. */
  payout(): Promise<PayoutDestination | null>;
  /** The inbox, newest first. One page is every notification the pilot produces. */
  notifications(): Promise<CollectorNotificationRow[]>;
  /**
   * Stamp one as read. Idempotent on the server — `read_at is null` is in the
   * WHERE — so a second tap keeps the first instant and this resolves either way.
   */
  markNotificationRead(id: string): Promise<void>;
}
