import type {
  AgreementId,
  BoundDevice,
  Claim,
  CollectionSession,
  CollectorApi,
  CollectorProfile,
  EpisodeUpload,
  IncomeEntry,
  SessionInput,
  Task,
} from './types.ts';
import { AGREEMENTS, ApiError } from './types.ts';

/**
 * In-memory server. It mirrors the server-side gates (APP-02, APP-05, APP-10,
 * APP-15) so the UI can be exercised honestly, but the real enforcement is the
 * server's — this object is for development and tests, and every rule it
 * checks exists on the server too.
 *
 * The seed deliberately contains other collectors' presence: a task already at
 * claimant capacity, episodes from two different sessions, income both
 * estimated and confirmed. Single-actor fixtures hid a real payment bug once.
 */

/** APP-04's exam is a mechanism shell; PaXini owes the content (D-item). */
export const EXAM_QUESTION_COUNT = 3;

let seq = 0;
const id = (prefix: string): string => `${prefix}-${(++seq).toString().padStart(4, '0')}`;

export class MockCollectorApi implements CollectorApi {
  private me: CollectorProfile | null = null;
  private claims: Claim[] = [];
  private devices: BoundDevice[] = [];
  private sessionRows: CollectionSession[] = [];
  private episodeRows: EpisodeUpload[];
  private taskRows: Task[];
  private incomeRows: IncomeEntry[];

  constructor() {
    this.taskRows = [
      {
        id: 'task-cook',
        title: 'Nấu ăn tại nhà',
        scenario: 'home',
        unitPriceVndPerMinute: '1200',
        targetMinutes: 3000,
        claimedMinutes: 420,
        maxClaimants: 5,
        claimants: 2,
        instructions:
          'Đeo thiết bị khi chuẩn bị bữa ăn hằng ngày. Ghi lại thao tác tự nhiên, không diễn.',
        privacyNotice: 'Không quay người khác khi chưa được đồng ý. Che thông tin cá nhân trên giấy tờ.',
        paymentRule: 'Trả theo phút hiệu quả đã duyệt.',
      },
      {
        id: 'task-office',
        title: 'Làm việc văn phòng',
        scenario: 'office',
        unitPriceVndPerMinute: '1000',
        targetMinutes: 6000,
        claimedMinutes: 5800,
        // Seeded FULL by other collectors: APP-10's cap is visible in the hall.
        maxClaimants: 2,
        claimants: 2,
        instructions: 'Thao tác bàn phím, giấy tờ, họp nhóm. Tránh màn hình chứa dữ liệu nội bộ.',
        privacyNotice: 'Cần sự đồng ý của đồng nghiệp xuất hiện trong khung hình.',
        paymentRule: 'Trả theo phút hiệu quả đã duyệt.',
      },
      {
        id: 'task-warehouse',
        title: 'Sắp xếp kho hàng',
        scenario: 'warehouse',
        unitPriceVndPerMinute: '1500',
        targetMinutes: 9000,
        claimedMinutes: 0,
        maxClaimants: 8,
        claimants: 0,
        instructions: 'Bốc xếp, dán nhãn, kiểm kê. Giữ thiết bị chắc chắn khi cúi người.',
        privacyNotice: 'Cần giấy phép của quản lý kho trước khi ghi hình.',
        paymentRule: 'Trả theo phút hiệu quả đã duyệt.',
      },
    ];
    // Two sessions' worth of episodes, spread over the six APP-23 states.
    this.episodeRows = [
      { episodeId: 'ego1-20260821-0715', sessionId: 'ses-0001', sizeBytes: 2_147_483_648, state: 'pending_upload' },
      { episodeId: 'ego1-20260821-0902', sessionId: 'ses-0001', sizeBytes: 1_610_612_736, state: 'pending_upload' },
      { episodeId: 'ego1-20260820-1830', sessionId: 'ses-0002', sizeBytes: 3_221_225_472, state: 'under_review' },
      { episodeId: 'ego1-20260819-1120', sessionId: 'ses-0002', sizeBytes: 2_684_354_560, state: 'review_passed' },
      {
        episodeId: 'ego1-20260819-0640',
        sessionId: 'ses-0002',
        sizeBytes: 1_073_741_824,
        state: 'review_failed',
        rejectReason: 'Ống kính bị che trong phần lớn thời lượng.',
      },
    ];
    this.incomeRows = [
      // Confirmed: a verdict exists, the server wrote the settlement row.
      // `pending_settlement` and not `pending_review`: both are legal values
      // of `settlements.settlement_state`, but the verdict path writes this
      // one (`packages/api/src/review.ts:777`), and a settlement that reached
      // the collector's income screen is by definition past review.
      {
        episodeId: 'ego1-20260819-1120',
        effectiveMinutes: '41.5',
        amountVnd: '49800',
        kind: 'confirmed',
        settlementState: 'pending_settlement',
      },
      { episodeId: 'ego1-20260819-0640', effectiveMinutes: '0', amountVnd: '0', kind: 'confirmed', settlementState: null },
      // Estimated: uploaded but not yet decided. Server's estimate, not ours.
      { episodeId: 'ego1-20260820-1830', effectiveMinutes: '52', amountVnd: '62400', kind: 'estimated', settlementState: null },
    ];
  }

  /**
   * There is no sign-in in the mock, and there deliberately is not one.
   *
   * ponytail: the three auth methods are the seam's shape, not a second
   * implementation of it. A code this object checked would be a code this
   * object invented, and the thing that actually decides whether a collector
   * may sign in is `POST /auth/collector/verify` against a `collectors` row. So
   * the mock is always signed in: `restoreSession()` is true and the app opens on
   * the registration screen exactly as it did before there was any auth.
   */
  async requestSignInCode(): Promise<void> {}

  async signIn(): Promise<void> {}

  async restoreSession(): Promise<boolean> {
    return true;
  }

  private mustProfile(): CollectorProfile {
    if (this.me === null) throw new ApiError('not_registered');
    return this.me;
  }

  /**
   * Every read hands out a copy.
   *
   * These used to return the live arrays and the live row objects, which is
   * not what an HTTP client does and is not safe: a screen could mutate the
   * "server", and a test could compare a list to itself and pass whatever
   * happened in between. One of them did exactly that — the manual-upload
   * regression held aliases of the very rows it was checking had not moved.
   */
  async profile(): Promise<CollectorProfile | null> {
    return this.me === null ? null : { ...this.me, agreements: this.me.agreements.map((a) => ({ ...a })) };
  }

  async register(name: string, phone: string): Promise<CollectorProfile> {
    if (name.trim() === '' || phone.trim() === '') throw new ApiError('missing_fields');
    this.me = { id: id('col'), name, phone, agreements: [], trainingDone: false, examPassed: false };
    return { ...this.me };
  }

  async acceptAgreements(
    acceptances: { agreementId: AgreementId; version: string }[],
  ): Promise<CollectorProfile> {
    const me = this.mustProfile();
    // APP-02: all six, each at the version currently presented. A stale or
    // partial acceptance is no acceptance.
    for (const a of AGREEMENTS) {
      const got = acceptances.find((x) => x.agreementId === a.id);
      if (got === undefined || got.version !== a.version) throw new ApiError('agreements_incomplete');
    }
    const acceptedAt = new Date().toISOString();
    me.agreements = acceptances.map((a) => ({ ...a, acceptedAt }));
    return { ...me, agreements: me.agreements.map((a) => ({ ...a })) };
  }

  async completeTraining(): Promise<CollectorProfile> {
    const me = this.mustProfile();
    me.trainingDone = true;
    return { ...me };
  }

  async submitExam(answers: boolean[]): Promise<{ passed: boolean }> {
    const me = this.mustProfile();
    // Mechanism only: the shell "passes" when every check is answered yes.
    // PaXini's real questions and grading replace this with the content drop.
    const passed = answers.length === EXAM_QUESTION_COUNT && answers.every(Boolean);
    if (passed) me.examPassed = true;
    return { passed };
  }

  async tasks(): Promise<Task[]> {
    return this.taskRows.map((t) => ({ ...t }));
  }

  private taskRow(taskId: string): Task {
    const found = this.taskRows.find((t) => t.id === taskId);
    if (found === undefined) throw new ApiError('task_not_found');
    return found;
  }

  async task(taskId: string): Promise<Task> {
    return { ...this.taskRow(taskId) };
  }

  /**
   * The whole eligibility contract, in the order a collector meets it.
   *
   * APP-02 (all six agreements, at the version shown), APP-03/04 (training,
   * then the exam) and APP-05 (no exam pass, no claiming) are one gate, not
   * three optional ones. This mock previously checked the last of them only,
   * so registering and answering the exam yes was enough to claim a task —
   * an onboarding bypass the server will not honour, taught to every screen
   * developed against it.
   */
  private mustBeEligible(): CollectorProfile {
    const me = this.mustProfile();
    for (const a of AGREEMENTS) {
      const accepted = me.agreements.find((x) => x.agreementId === a.id);
      if (accepted === undefined || accepted.version !== a.version) {
        throw new ApiError('agreements_incomplete');
      }
    }
    if (!me.trainingDone) throw new ApiError('training_incomplete');
    if (!me.examPassed) throw new ApiError('exam_not_passed');
    return me;
  }

  async claimTask(taskId: string): Promise<Claim> {
    this.mustBeEligible();
    const task = this.taskRow(taskId);
    if (task.claimants >= task.maxClaimants) throw new ApiError('task_at_capacity');
    if (this.claims.some((c) => c.taskId === taskId)) throw new ApiError('already_claimed');
    task.claimants += 1;
    const claim: Claim = { id: id('claim'), taskId, claimedAt: new Date().toISOString() };
    this.claims.push(claim);
    return { ...claim };
  }

  async myClaims(): Promise<Claim[]> {
    return this.claims.map((c) => ({ ...c }));
  }

  async boundDevices(): Promise<BoundDevice[]> {
    return this.devices.map((d) => ({ ...d }));
  }

  async bindDevice(serial: string): Promise<BoundDevice> {
    this.mustProfile();
    const trimmed = serial.trim();
    if (trimmed === '') throw new ApiError('serial_empty');
    if (this.devices.some((d) => d.serial === trimmed)) throw new ApiError('already_bound');
    const device: BoundDevice = { serial: trimmed, boundAt: new Date().toISOString() };
    this.devices.push(device);
    return { ...device };
  }

  async createSession(input: SessionInput): Promise<CollectionSession> {
    const me = this.mustProfile();
    // APP-15: no device binding, no collection preparation.
    if (!this.devices.some((d) => d.serial === input.deviceSerial)) throw new ApiError('device_not_bound');
    if (!this.claims.some((c) => c.taskId === input.taskId)) throw new ApiError('task_not_claimed');
    const session: CollectionSession = {
      ...input,
      id: id('ses'),
      collectorId: me.id,
      createdAt: new Date().toISOString(),
    };
    this.sessionRows.push(session);
    return { ...session };
  }

  async sessions(): Promise<CollectionSession[]> {
    return this.sessionRows.map((s) => ({ ...s }));
  }

  async episodes(): Promise<EpisodeUpload[]> {
    return this.episodeRows.map((e) => ({ ...e }));
  }

  async confirmUpload(episodeId: string): Promise<EpisodeUpload> {
    this.mustProfile();
    const episode = this.episodeRows.find((e) => e.episodeId === episodeId);
    if (episode === undefined) throw new ApiError('episode_not_found');
    if (episode.state !== 'pending_upload') throw new ApiError('not_pending');
    // `uploading` is where it stops. A two-second timer used to flip it to
    // `uploaded` for demo effect: it moved no bytes, told React Query nothing,
    // so the screen sat on `uploading` anyway, and it put a state change in
    // the one class that must not have one. Removed. The transition out of
    // `uploading` belongs to the transfer worker that does not exist yet.
    episode.state = 'uploading';
    return { ...episode };
  }

  async income(): Promise<IncomeEntry[]> {
    return this.incomeRows.map((i) => ({ ...i }));
  }
}
