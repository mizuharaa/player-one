import { numParam, strListParam, type Finding, type TuningMap } from '../types.ts';

/**
 * VOLUME signals. Every threshold that could be absolute is relative to a
 * cohort or to the collector's own history instead — an absolute number is
 * wrong on day one and wronger every week after, because nobody knows yet
 * what a normal day of ego collection looks like. The two that are absolute
 * (12 hours in a day, and "night") are physical, not statistical.
 *
 * Days are Asia/Ho_Chi_Minh, UTC+7 with no daylight saving, carried as
 * `utc_offset_minutes` on each signal so a second region is a retune and not
 * a deploy. Durations are the engine's measured seconds, never the manifest's.
 */

export type EpisodeSlice = {
  episodeId: string;
  /** Usable window, epoch milliseconds. */
  startMs: number;
  endMs: number;
  /** Measured duration, seconds. The intersection of stream coverage, not the union. */
  measuredS: number;
  deviceSerial: string;
  taskType: string | null;
};

export type VolumeInput = {
  collectorId: string;
  /** This collector's episodes in the window. */
  episodes: readonly EpisodeSlice[];
  /** Episodes per (collector, day) for every collector in the window, this one included. */
  cohortDayCounts: readonly number[];
};

export const dayKey = (ms: number, offsetMinutes: number): string =>
  new Date(ms + offsetMinutes * 60_000).toISOString().slice(0, 10);

const localHour = (ms: number, offsetMinutes: number): number =>
  new Date(ms + offsetMinutes * 60_000).getUTCHours() + new Date(ms + offsetMinutes * 60_000).getUTCMinutes() / 60;

function perDay<T>(episodes: readonly EpisodeSlice[], offset: number, value: (e: EpisodeSlice) => T, add: (a: T, b: T) => T, zero: T) {
  const days = new Map<string, { total: T; episodes: number }>();
  for (const e of episodes) {
    const key = dayKey(e.startMs, offset);
    const cur = days.get(key) ?? { total: zero, episodes: 0 };
    days.set(key, { total: add(cur.total, value(e)), episodes: cur.episodes + 1 });
  }
  return days;
}

/** Nearest-rank percentile of a sample. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * s.length));
  return s[rank - 1]!;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

export function volumeSignals(input: VolumeInput, tuning: TuningMap): Finding[] {
  const out: Finding[] = [];
  const eps = [...input.episodes].sort((a, b) => a.startMs - b.startMs || (a.episodeId < b.episodeId ? -1 : 1));

  const hours = tuning.get('VOL.HOURS_PER_DAY');
  if (hours?.enabled && eps.length > 0) {
    const offset = numParam(hours, 'utc_offset_minutes', 420);
    const max = numParam(hours, 'max_hours', 12);
    const days = perDay(eps, offset, (e) => e.measuredS / 3600, (a, b) => a + b, 0);
    let worst: { day: string; hours: number; episodes: number } | null = null;
    for (const [day, d] of days) {
      if (d.total > max && (worst === null || d.total > worst.hours)) worst = { day, hours: d.total, episodes: d.episodes };
    }
    if (worst !== null) {
      out.push({
        signalId: 'VOL.HOURS_PER_DAY',
        evidence: { day: worst.day, hours: r1(worst.hours), max_hours: max, episodes: worst.episodes },
      });
    }
  }

  const p95 = tuning.get('VOL.ABOVE_COHORT_P95');
  if (p95?.enabled && eps.length > 0) {
    const offset = numParam(p95, 'utc_offset_minutes', 420);
    const minCohort = numParam(p95, 'min_cohort_days', 20);
    const minEpisodes = numParam(p95, 'min_episodes', 3);
    if (input.cohortDayCounts.length >= minCohort) {
      const edge = percentile(input.cohortDayCounts, 95);
      const days = perDay(eps, offset, () => 1, (a, b) => a + b, 0);
      let worst: { day: string; episodes: number } | null = null;
      for (const [day, d] of days) {
        if (d.episodes > edge && d.episodes >= minEpisodes && (worst === null || d.episodes > worst.episodes)) {
          worst = { day, episodes: d.episodes };
        }
      }
      if (worst !== null) {
        out.push({
          signalId: 'VOL.ABOVE_COHORT_P95',
          evidence: { day: worst.day, episodes: worst.episodes, p95: edge, cohort_days: input.cohortDayCounts.length },
        });
      }
    }
  }

  const step = tuning.get('VOL.STEP_CHANGE');
  if (step?.enabled && eps.length > 0) {
    const offset = numParam(step, 'utc_offset_minutes', 420);
    const ratio = numParam(step, 'ratio', 2.5);
    const trailing = numParam(step, 'trailing_days', 28);
    const minHistory = numParam(step, 'min_history_days', 5);
    const minMinutes = numParam(step, 'min_minutes', 30);
    const days = [...perDay(eps, offset, (e) => e.measuredS / 60, (a, b) => a + b, 0)].sort(([a], [b]) => (a < b ? -1 : 1));
    let worst: { day: string; minutes: number; med: number; history: number } | null = null;
    for (let i = 0; i < days.length; i++) {
      const [day, d] = days[i]!;
      const dayMs = Date.parse(`${day}T00:00:00Z`);
      const history = days
        .slice(0, i)
        .filter(([h]) => Date.parse(`${h}T00:00:00Z`) >= dayMs - trailing * 86_400_000)
        .map(([, v]) => v.total);
      if (history.length < minHistory) continue;
      const med = median(history);
      if (med <= 0 || d.total < minMinutes) continue;
      if (d.total > ratio * med && (worst === null || d.total / med > worst.minutes / worst.med)) {
        worst = { day, minutes: d.total, med, history: history.length };
      }
    }
    if (worst !== null) {
      out.push({
        signalId: 'VOL.STEP_CHANGE',
        evidence: {
          day: worst.day,
          minutes: r1(worst.minutes),
          median_minutes: r1(worst.med),
          ratio: r1(worst.minutes / worst.med),
          threshold_ratio: ratio,
          history_days: worst.history,
        },
      });
    }
  }

  const gap = tuning.get('VOL.NO_GAP');
  if (gap?.enabled && eps.length > 1) {
    const minGap = numParam(gap, 'min_gap_s', 0) * 1000;
    let worst: { a: EpisodeSlice; b: EpisodeSlice; gapMs: number } | null = null;
    for (let i = 1; i < eps.length; i++) {
      const a = eps[i - 1]!;
      const b = eps[i]!;
      const g = b.startMs - a.endMs;
      if (g < minGap && (worst === null || g < worst.gapMs)) worst = { a, b, gapMs: g };
    }
    if (worst !== null) {
      out.push({
        signalId: 'VOL.NO_GAP',
        evidence: {
          episode_a: worst.a.episodeId,
          episode_b: worst.b.episodeId,
          gap_s: r1(worst.gapMs / 1000),
          overlap_s: r1(Math.max(0, -worst.gapMs) / 1000),
          min_gap_s: minGap / 1000,
          device_a: worst.a.deviceSerial,
          device_b: worst.b.deviceSerial,
        },
      });
    }
  }

  const night = tuning.get('VOL.NOCTURNAL');
  if (night?.enabled && eps.length > 0) {
    const offset = numParam(night, 'utc_offset_minutes', 420);
    const start = numParam(night, 'night_start_hour', 23);
    const end = numParam(night, 'night_end_hour', 5);
    const minShare = numParam(night, 'min_share', 0.5);
    const minMinutes = numParam(night, 'min_minutes', 60);
    const nightTypes = new Set(strListParam(night, 'night_task_types'));
    const isNight = (h: number): boolean => (start > end ? h >= start || h < end : h >= start && h < end);
    let total = 0;
    let dark = 0;
    const types = new Map<string, number>();
    for (const e of eps) {
      const type = e.taskType ?? '(unknown)';
      if (nightTypes.has(type)) continue;
      // Walk the episode in minutes; an episode is at most hours, so this is cheap.
      const minutes = Math.max(1, Math.round(e.measuredS / 60));
      for (let m = 0; m < minutes; m++) {
        total += 1;
        if (isNight(localHour(e.startMs + m * 60_000, offset))) dark += 1;
      }
      types.set(type, (types.get(type) ?? 0) + minutes);
    }
    if (total >= minMinutes && dark / total >= minShare) {
      const dominant = [...types].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '(unknown)';
      const hh = (h: number): string => `${String(h).padStart(2, '0')}:00`;
      out.push({
        signalId: 'VOL.NOCTURNAL',
        evidence: {
          night_minutes: dark,
          total_minutes: total,
          share: Math.round((dark / total) * 100) / 100,
          night_hours: `${hh(start)}–${hh(end)}`,
          task_type: dominant,
        },
      });
    }
  }

  return out;
}
