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

/** APP-02's six agreements, versioned. Acceptance names the version it saw. */
export const AGREEMENTS = [
  { id: 'user', version: '1.0' },
  { id: 'privacy', version: '1.0' },
  { id: 'data_collection', version: '1.0' },
  { id: 'data_commercial_use', version: '1.0' },
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
 * The typed client every screen talks to. The mock below implements it today;
 * the real HTTP client implements it when the server side exists.
 *
 * ponytail: mock implementation only — the real client lands with auth and
 * the server endpoints (a sibling workstream owns the server gates).
 */
export interface CollectorApi {
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
