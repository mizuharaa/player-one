import { sql } from 'drizzle-orm';
import { DISCREPANCY_CODES } from '@playerone/contracts';
import type { Db } from './db.ts';
import { defectCodes, reviewReasonCodes } from './schema.ts';

/**
 * The two catalogues, as data.
 *
 * Neither is a CHECK and neither is an enum, for the reason PaXini gave on
 * 13 Aug: the in-the-wild review standard does not exist yet and will be
 * rewritten during the pilot. Re-tuning routing has to be an UPDATE an operator
 * runs, not a migration a developer ships.
 */

/** `excluded.x` is the value the conflicting insert tried to write. */
const sqlExcluded = (column: string) => sql.raw(`excluded.${column}`);

/**
 * Whether a defect stops a human judging the episode, and whether it stops the
 * episode being payable. Two questions, two columns — one boolean cannot answer
 * both without forcing a choice between an unusable dataset and an unpaid
 * collector who did nothing wrong.
 *
 * Blocking is reserved for "a reviewer cannot judge this": the media is gone,
 * unreadable, or short. Everything else reaches review with a banner, because
 * UPL-10 and UPL-12 are explicit that an unclosed session, zeroed statistics or
 * a zero-byte PTS file is flagged and kept — and 073055 is 458 MB of good video
 * behind exactly that kind of defect.
 */
const BLOCKING = new Set([
  'MEDIA-MISSING',
  'MEDIA-UNREADABLE',
  'MEDIA-TRUNCATED',
  'PART-MISSING-INTERIOR',
  /**
   * CHECKSUM-MISMATCH is deliberately NOT here (integration decision,
   * 2026-08-26, reversible).
   *
   * The cloud leg made it blocking on the argument that a reviewer "cannot
   * decide which of two conflicting deliveries they are being paid to judge".
   * The review-queue slice answers that structurally: every review row names
   * its `ingest_id`, the queue only ever routes `episodes.latest_ingest_id`,
   * and an earlier verdict stays attached to the delivery it judged
   * (review.test.ts, "routes the delivery the queue is waiting on"). So a
   * local mismatch is a flagged, judgeable redelivery — blocking is reserved
   * for "a reviewer cannot judge this" — and with no per-episode clearing
   * route yet, blocking it would make every redelivery unpayable for the
   * whole pilot.
   *
   * What DOES block is the cloud read-back failing: `eligible` in review.ts
   * refuses `verification_state = 'failed'` under either gate. That is UPL-04's
   * "mismatch blocks review", and it is about the cloud checksum (QR-02).
   * Flipping this code back is one UPDATE; if it is flipped, the two lane
   * tests named above are where the redelivery fixture has to change.
   */
]);

/**
 * CALIB-MISSING is deliberately absent from BLOCKING and from this set.
 *
 * Acceptance 10.3.8 wants calibration on every episode, but the collector did
 * not cause its absence: 073055 shipped a camera calibration and no IMU one,
 * which is the device's doing. Whether a blocking defect should also suppress
 * settlement — and who absorbs the cost — is the product owner's call, not
 * this file's. Seeded permissive so nothing is withheld by default; flipping it
 * is one UPDATE per code.
 */
const SUPPRESSES_SETTLEMENT = new Set<string>([]);

const DESCRIPTIONS: Partial<Record<string, string>> = {
  'MEDIA-MISSING': 'A stream the session declares has no media on disk.',
  'MEDIA-UNREADABLE': 'A container exists but cannot be decoded.',
  'MEDIA-TRUNCATED': 'A container is structurally short: the transfer did not finish.',
  'PART-MISSING-INTERIOR': 'A part is missing from the middle of a multi-part stream.',
  'CALIB-MISSING': 'Calibration did not travel with the episode.',
  'CHECKSUM-MISMATCH': 'The bytes changed between two deliveries of one session.',
  'SESSION-UNCLOSED': 'The device never wrote an end time; the recording is still fine.',
  'EPISODE-ID-FALLBACK': 'The directory name does not parse; the id falls back to the raw name.',
  'SERIAL-CONFLICT': 'Basename, manifest and calibration disagree on the device serial.',
  'SESSION-CONFLICT': 'The declared session id disagrees with the handover record.',
};

/**
 * Every code in the union, including the ones only the platform raises
 * (CHECKSUM-MISMATCH at store time, SESSION-CONFLICT at resolution). Seeding
 * from the union is what keeps the two in step: a new code with no routing
 * decision fails the catalogue test rather than silently defaulting to
 * "reaches review".
 */
export const DEFECT_CATALOGUE = DISCREPANCY_CODES.map((code) => ({
  code,
  blocksReview: BLOCKING.has(code),
  suppressesSettlement: SUPPRESSES_SETTLEMENT.has(code),
  description: DESCRIPTIONS[code] ?? code,
  active: true,
}));

/**
 * §6.9's failure reasons. Vietnamese for the collector (LOC-04, QR-04) and
 * Chinese for PaXini's reviewers (LOC-02); English is the back-office default.
 * Vietnamese strings are placeholders pending VNG localisation review — the
 * column exists so the pilot cannot ship without someone noticing they are.
 */
export const REVIEW_REASON_CATALOGUE = [
  ['VQ-OCCLUSION', 'visual_quality', 'Lens occluded', 'Ống kính bị che', '镜头遮挡'],
  ['VQ-BLURRY', 'visual_quality', 'Image blurry', 'Hình ảnh bị mờ', '图像模糊'],
  ['VQ-DARK', 'visual_quality', 'Too dark', 'Quá tối', '过暗'],
  ['VQ-OVEREXPOSED', 'visual_quality', 'Overexposed', 'Quá sáng', '过曝'],
  ['VQ-JITTER', 'visual_quality', 'Severe jitter', 'Rung lắc mạnh', '严重抖动'],
  ['TQ-MISMATCH', 'task_quality', 'Does not match the task', 'Không khớp với nhiệm vụ', '与任务不符'],
  ['TQ-MEANINGLESS', 'task_quality', 'Meaningless behaviour', 'Hành vi không có ý nghĩa', '无意义行为'],
  ['TQ-REPETITIVE', 'task_quality', 'Highly repetitive scenario', 'Bối cảnh lặp lại nhiều', '场景高度重复'],
  ['DI-INCOMPLETE', 'data_integrity', 'Incomplete upload', 'Tải lên chưa hoàn tất', '上传不完整'],
  ['DI-NO-VIDEO', 'data_integrity', 'Missing video', 'Thiếu video', '缺少视频'],
  ['DI-NO-IMU', 'data_integrity', 'Missing IMU', 'Thiếu dữ liệu IMU', '缺少IMU'],
  ['DI-BAD-TIMESTAMPS', 'data_integrity', 'Abnormal timestamps', 'Dấu thời gian bất thường', '时间戳异常'],
  ['CO-PRIVACY', 'compliance', 'Privacy risk present', 'Có rủi ro về quyền riêng tư', '存在隐私风险'],
].map(([code, category, labelEn, labelVi, labelZh]) => ({
  code: code!,
  category: category!,
  labelEn: labelEn!,
  labelVi: labelVi!,
  labelZh: labelZh!,
  active: true,
}));

/**
 * Idempotent: re-running updates the routing flags and leaves everything else.
 * Codes are never deleted — an episode already carrying one still has to render.
 */
export async function seedCatalogues(db: Db): Promise<void> {
  await db
    .insert(defectCodes)
    .values(DEFECT_CATALOGUE)
    .onConflictDoUpdate({
      target: defectCodes.code,
      set: {
        blocksReview: sqlExcluded('blocks_review'),
        suppressesSettlement: sqlExcluded('suppresses_settlement'),
        description: sqlExcluded('description'),
      },
    });

  /**
   * Reason codes are seeded once and never overwritten.
   *
   * This is the difference between reference data and configuration, and the
   * two catalogues are not the same kind of thing. `blocks_review` above is a
   * routing decision the deployed engine owns, so re-seeding re-tunes it. A
   * reason code's category and its three labels are the *review standard*, and
   * PaXini said on 13 Aug it does not exist yet and will be rewritten during
   * the pilot — §6.9's own note says to build the codes configurable rather
   * than hard-coded. Upserting them made an operator's UPDATE last until the
   * next restart, which is a worse failure than not being editable at all:
   * nothing errors, the labels simply revert and the pilot's own tuning is
   * silently lost.
   *
   * So: a code the deployment does not have yet is inserted; one it has is left
   * exactly as the operator left it, including `active`, which is how a code is
   * retired without orphaning the reviews that already cite it.
   */
  await db.insert(reviewReasonCodes).values(REVIEW_REASON_CATALOGUE).onConflictDoNothing();
}
