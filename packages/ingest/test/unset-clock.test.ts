import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { ingest } from '../src/ingest.ts';

/**
 * The Ego has no battery-backed real-time clock, and the thing that would set
 * it is the companion app, which does not exist. Every session on the corpus
 * that arrived on 2026-09-04 is stamped 1970-01-01.
 *
 * The engine must still measure such a session normally -- nothing that becomes
 * money reads the wall clock -- and must say plainly that the clock was unset,
 * because "the device had no clock" and "this card is genuinely ambiguous" are
 * different problems and they look identical in an operator's queue otherwise.
 */
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'sessions');

describe('a device whose clock was never set', () => {
  it('raises DEVICE-CLOCK-UNSET, keeps the raw value, and still measures the media', async () => {
    const rec = await ingest(
      join(FIXTURES, 'unset-clock', 'ego_SYNTH0000002_19700101_003357'),
    );

    const flag = rec.discrepancies.find((d) => d.code === 'DEVICE-CLOCK-UNSET');
    expect(flag, 'DEVICE-CLOCK-UNSET should fire on an epoch-stamped manifest').toBeDefined();

    /** The raw value is reported, never replaced with a guess. */
    expect(flag!.detail).toContain('1970-01-01T00:33:57.875');

    /**
     * A flag, not an error: the footage is usable and still pays. If this ever
     * becomes blocking, a whole pilot's footage stops being reviewable.
     */
    expect(flag!.severity).toBe('flag');
    expect(rec.state).not.toBe('quarantined');

    /** Timing comes from the PTS sidecars, which are relative to themselves. */
    expect(Number(rec.timing.raw_duration_s)).toBeGreaterThan(0);
  });

  it('does not fire on a session whose clock is set', async () => {
    const rec = await ingest(
      join(FIXTURES, 'clock-fault', 'ego_SYNTH0000001_20260813_091200'),
    );
    expect(rec.discrepancies.find((d) => d.code === 'DEVICE-CLOCK-UNSET')).toBeUndefined();
  });
});
