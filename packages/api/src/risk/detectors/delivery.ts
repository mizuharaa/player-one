import { numParam, strListParam, type Finding, type TuningMap } from '../types.ts';

/**
 * DELIVERY signals: what the record of how an episode ARRIVED says, as opposed
 * to what the picture in it looks like.
 *
 * Everything here reads rows the store already writes. One episode can be
 * delivered many times — the card at the upload centre, a cloud re-download, a
 * retry after a link died — and `packages/store/src/index.ts` writes a new
 * `episode_ingests` row every time the bytes differ, with a CHECKSUM-MISMATCH
 * defect that names each file that changed, was added or was removed. That
 * defect payload is the whole evidence base for these three signals.
 *
 * The distinction they draw, and its limits, in plain words:
 *
 *   An interrupted transfer LOSES bytes. The tail file is short, a file is
 *   missing, the measured duration goes down. Nothing about the footage the
 *   collector actually recorded has changed.
 *
 *   A substitution REPLACES bytes. A file that was already delivered whole
 *   comes back with a different sha256, or the measured duration goes UP on a
 *   redelivery. A dropped Wi-Fi link cannot do that; a person with the card in
 *   a laptop can.
 *
 * That is a heuristic, not a proof, and it is deliberately a 'review' and not
 * a 'hold': a card that fails intermittently in two different places can
 * produce a changed file, and an operator has to look. It is also blind to a
 * substitution made BEFORE the first delivery — there is nothing to compare
 * against — which is the honest ceiling of every signal in this file.
 */

export type DeliveryFacts = {
  episodeId: string;
  /** How many `episode_ingests` rows this episode has. One is normal. */
  deliveries: number;
  /** How many of those carried CHECKSUM-MISMATCH. */
  mismatchDeliveries: number;
  firstDeliveredAt: Date | null;
  lastDeliveredAt: Date | null;
  /** The latest delivery's mismatch payload, when it had one. */
  latest: MismatchFacts | null;
  /** Microsecond wall clock of the recording itself, from the ingest record's timing. */
  recordedAtMs: number | null;
};

export type MismatchFacts = {
  priorIngestId: string;
  changed: string[];
  added: string[];
  removed: string[];
  /** Measured seconds now, and on the delivery this one superseded. */
  measuredS: number;
  priorMeasuredS: number | null;
};

const r2 = (n: number): number => Math.round(n * 100) / 100;

const isMedia = (path: string, suffixes: readonly string[]): boolean =>
  suffixes.some((s) => path.toLowerCase().endsWith(s));

export function deliverySignals(facts: DeliveryFacts, now: Date, tuning: TuningMap): Finding[] {
  const out: Finding[] = [];
  const t = (id: string) => {
    const x = tuning.get(id);
    return x?.enabled ? x : null;
  };

  const churn = t('CONT.REDELIVERY_CHURN');
  if (churn && facts.mismatchDeliveries > 0) {
    const max = numParam(churn, 'max_deliveries', 2);
    if (facts.deliveries > max) {
      const spanH =
        facts.firstDeliveredAt && facts.lastDeliveredAt
          ? (facts.lastDeliveredAt.getTime() - facts.firstDeliveredAt.getTime()) / 3_600_000
          : null;
      out.push({
        signalId: 'CONT.REDELIVERY_CHURN',
        evidence: {
          deliveries: facts.deliveries,
          mismatch_deliveries: facts.mismatchDeliveries,
          max_deliveries: max,
          first_delivered_at: facts.firstDeliveredAt?.toISOString() ?? null,
          last_delivered_at: facts.lastDeliveredAt?.toISOString() ?? null,
          hours_between: spanH === null ? null : r2(spanH),
        },
      });
    }
  }

  const sub = t('CONT.MEDIA_SUBSTITUTED');
  if (sub && facts.latest !== null) {
    const suffixes = strListParam(sub, 'media_suffixes', ['.mp4', '.wav']);
    const m = facts.latest;
    const changed = m.changed.filter((p) => isMedia(p, suffixes));
    // A redelivery that measures LONGER than the one it replaced is not a
    // recovered truncation; there is more footage than arrived the first time.
    const grewBy =
      m.priorMeasuredS !== null && m.measuredS > m.priorMeasuredS ? m.measuredS - m.priorMeasuredS : 0;
    const minGrowth = numParam(sub, 'min_growth_s', 1);
    if (changed.length > 0 || grewBy >= minGrowth) {
      out.push({
        signalId: 'CONT.MEDIA_SUBSTITUTED',
        evidence: {
          prior_ingest_id: m.priorIngestId,
          changed_media: changed,
          changed_media_count: changed.length,
          added: m.added,
          removed: m.removed,
          measured_s: r2(m.measuredS),
          prior_measured_s: m.priorMeasuredS === null ? null : r2(m.priorMeasuredS),
          grew_by_s: r2(grewBy),
          min_growth_s: minGrowth,
        },
      });
    }
  }

  const stale = t('PROV.STALE_RECORDING');
  if (stale && facts.recordedAtMs !== null && facts.firstDeliveredAt !== null) {
    const maxDays = numParam(stale, 'max_age_days', 30);
    const ageDays = (facts.firstDeliveredAt.getTime() - facts.recordedAtMs) / 86_400_000;
    if (ageDays > maxDays) {
      out.push({
        signalId: 'PROV.STALE_RECORDING',
        evidence: {
          recorded_at: new Date(facts.recordedAtMs).toISOString(),
          first_delivered_at: facts.firstDeliveredAt.toISOString(),
          age_days: r2(ageDays),
          max_age_days: maxDays,
          evaluated_at: now.toISOString(),
        },
      });
    }
  }

  return out;
}
