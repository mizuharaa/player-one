import { describe, expect, it } from 'vitest';
import { BACKOFF, baseDelayMs, dueAt, jitterFor } from '../../../src/payout/worker/poll.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('the poll schedule', () => {
  it('backs off 5s, 15s, 30s, 60s, then five minutes to a day, then hourly to a week, then stops', () => {
    expect(baseDelayMs(0, 0)).toBe(5_000);
    expect(baseDelayMs(1, 5_000)).toBe(15_000);
    expect(baseDelayMs(2, 20_000)).toBe(30_000);
    expect(baseDelayMs(3, 50_000)).toBe(60_000);
    expect(baseDelayMs(4, 110_000)).toBe(5 * MIN);
    expect(baseDelayMs(200, DAY - 1)).toBe(5 * MIN);
    expect(baseDelayMs(300, DAY)).toBe(HOUR);
    expect(baseDelayMs(400, 7 * DAY - 1)).toBe(HOUR);
    expect(baseDelayMs(500, 7 * DAY)).toBeNull();
    expect(BACKOFF.stopAfterMs).toBe(7 * DAY);
  });

  it('jitters deterministically per attempt and poll count, uniformly in [0, 1)', () => {
    const a = jitterFor('attempt-1', 0);
    expect(a).toBe(jitterFor('attempt-1', 0));
    expect(a).not.toBe(jitterFor('attempt-1', 1));
    expect(a).not.toBe(jitterFor('attempt-2', 0));
    const samples = Array.from({ length: 2000 }, (_, i) => jitterFor(`id-${i}`, i % 7));
    for (const s of samples) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
    const mean = samples.reduce((x, y) => x + y, 0) / samples.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });

  it('anchors the next poll on the last one, or on creation before any', () => {
    const created = new Date('2026-08-26T09:00:00Z');
    const half = () => 0.5;
    expect(dueAt({ id: 'x', createdAt: created, lastPolledAt: null, pollCount: 0 }, half)).toEqual(
      new Date(created.getTime() + 2_500),
    );
    const polled = new Date(created.getTime() + 6_000);
    expect(dueAt({ id: 'x', createdAt: created, lastPolledAt: polled, pollCount: 1 }, half)).toEqual(
      new Date(polled.getTime() + 7_500),
    );
    // Full jitter: a draw of zero is due immediately, a draw near one waits the whole base.
    expect(dueAt({ id: 'x', createdAt: created, lastPolledAt: polled, pollCount: 1 }, () => 0)).toEqual(polled);
  });

  it('stops after seven days, whatever the poll count', () => {
    const created = new Date('2026-08-01T00:00:00Z');
    const week = new Date(created.getTime() + 7 * DAY);
    expect(dueAt({ id: 'x', createdAt: created, lastPolledAt: week, pollCount: 3 })).toBeNull();
    expect(dueAt({ id: 'x', createdAt: created, lastPolledAt: week, pollCount: 900 })).toBeNull();
    const almost = new Date(week.getTime() - 1);
    expect(dueAt({ id: 'x', createdAt: created, lastPolledAt: almost, pollCount: 900 })).not.toBeNull();
  });
});
