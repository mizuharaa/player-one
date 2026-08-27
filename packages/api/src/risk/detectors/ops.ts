import { numParam, strListParam, type Finding, type TuningMap } from '../types.ts';
import { median } from './volume.ts';

/**
 * REVIEWER / OPERATOR signals. The people side of the money path: a verdict
 * that could not have involved watching the footage, a reviewer whose
 * approval rate is nothing like their peers', an operator paying a collector
 * they themselves created, and one operator sitting on all of one collector's
 * bills. Agent B's 0013 makes the third impossible going forward at the
 * database; this flags what the audit trail already holds.
 */

export type ReviewFact = {
  episodeId: string;
  reviewerId: string | null;
  reviewerRef: string | null;
  state: 'pending' | 'pass' | 'partial_pass' | 'fail';
  timeToVerdictS: number | null;
  measuredS: number;
};

/** Episode-level. */
export function reviewTooFast(review: ReviewFact, tuning: TuningMap): Finding[] {
  const t = tuning.get('OPS.REVIEW_TOO_FAST');
  if (!t?.enabled) return [];
  if (review.timeToVerdictS === null || review.state === 'pending' || review.state === 'fail') return [];
  const ratio = numParam(t, 'min_ratio', 1.0);
  if (review.timeToVerdictS >= review.measuredS * ratio) return [];
  return [
    {
      signalId: 'OPS.REVIEW_TOO_FAST',
      evidence: {
        reviewer_ref: review.reviewerRef ?? review.reviewerId ?? '(unknown)',
        reviewer_id: review.reviewerId,
        verdict: review.state,
        time_to_verdict_s: Math.round(review.timeToVerdictS * 10) / 10,
        measured_duration_s: Math.round(review.measuredS * 10) / 10,
        min_ratio: ratio,
      },
    },
  ];
}

export type ReviewerRate = { reviewerId: string; reviewerRef: string; decided: number; approved: number };

/** Batch-level: one finding per outlying reviewer, in the evidence of one flag. */
export function approvalOutliers(reviewers: readonly ReviewerRate[], tuning: TuningMap): Finding[] {
  const t = tuning.get('OPS.APPROVAL_OUTLIER');
  if (!t?.enabled) return [];
  const minDecided = numParam(t, 'min_decided', 20);
  const maxDelta = numParam(t, 'max_delta', 0.25);
  const minReviewers = numParam(t, 'min_reviewers', 3);
  const eligible = reviewers.filter((r) => r.decided >= minDecided);
  if (eligible.length < minReviewers) return [];
  const out: Finding[] = [];
  for (const r of eligible) {
    const others = eligible.filter((o) => o.reviewerId !== r.reviewerId).map((o) => o.approved / o.decided);
    const rate = r.approved / r.decided;
    const med = median(others);
    if (Math.abs(rate - med) > maxDelta) {
      out.push({
        signalId: 'OPS.APPROVAL_OUTLIER',
        evidence: {
          reviewer_ref: r.reviewerRef,
          reviewer_id: r.reviewerId,
          approval_rate: Math.round(rate * 100) / 100,
          cohort_median: Math.round(med * 100) / 100,
          decided: r.decided,
          reviewers: others.length,
          max_delta: maxDelta,
        },
      });
    }
  }
  // One flag per signal per subject: the worst reviewer leads, the rest ride in the evidence.
  if (out.length <= 1) return out;
  const sorted = out.sort((a, b) => Math.abs((b.evidence['approval_rate'] as number) - (b.evidence['cohort_median'] as number)) - Math.abs((a.evidence['approval_rate'] as number) - (a.evidence['cohort_median'] as number)));
  const [lead, ...rest] = sorted;
  return [{ signalId: lead!.signalId, evidence: { ...lead!.evidence, others: rest.map((f) => f.evidence) } }];
}

export type AuditFact = { operatorId: string; operatorRef: string; action: string; at: Date; targetId: string };

/** Bill-level: who created the collector, and who moved the bill. */
export function selfDealing(
  input: { collectorCreates: readonly AuditFact[]; billActions: readonly AuditFact[] },
  tuning: TuningMap,
): Finding[] {
  const t = tuning.get('OPS.SELF_DEALING');
  if (!t?.enabled) return [];
  const createActions = new Set(strListParam(t, 'create_actions', ['collector.create']));
  const payActions = new Set(strListParam(t, 'pay_actions', ['bill.pay']));
  const creators = new Map(input.collectorCreates.filter((a) => createActions.has(a.action)).map((a) => [a.operatorId, a]));
  const hit = input.billActions.find((a) => payActions.has(a.action) && creators.has(a.operatorId));
  if (hit === undefined) return [];
  const created = creators.get(hit.operatorId)!;
  return [
    {
      signalId: 'OPS.SELF_DEALING',
      evidence: {
        operator_ref: hit.operatorRef,
        operator_id: hit.operatorId,
        created_at: created.at.toISOString(),
        paid_action: hit.action,
        paid_at: hit.at.toISOString(),
      },
    },
  ];
}

/** Collector-level: one operator's share of the actions on this collector's bills. */
export function concentration(
  input: { events: readonly AuditFact[]; activeOperators: number },
  tuning: TuningMap,
): Finding[] {
  const t = tuning.get('OPS.CONCENTRATION');
  if (!t?.enabled) return [];
  const actions = new Set(strListParam(t, 'actions', ['bill.pay']));
  const maxShare = numParam(t, 'max_share', 0.8);
  const minEvents = numParam(t, 'min_events', 4);
  const minOperators = numParam(t, 'min_operators', 2);
  const events = input.events.filter((e) => actions.has(e.action));
  if (events.length < minEvents || input.activeOperators < minOperators) return [];
  const by = new Map<string, { ref: string; n: number }>();
  for (const e of events) {
    const cur = by.get(e.operatorId) ?? { ref: e.operatorRef, n: 0 };
    by.set(e.operatorId, { ref: cur.ref, n: cur.n + 1 });
  }
  const [topId, top] = [...by].sort((a, b) => b[1].n - a[1].n)[0]!;
  const share = top.n / events.length;
  if (share <= maxShare) return [];
  return [
    {
      signalId: 'OPS.CONCENTRATION',
      evidence: {
        operator_ref: top.ref,
        operator_id: topId,
        share: Math.round(share * 100) / 100,
        events: events.length,
        operators: input.activeOperators,
        max_share: maxShare,
      },
    },
  ];
}
