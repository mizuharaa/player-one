import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { deriveEpisodeId, parseSessionBasename } from '@playerone/contracts';
import { ingest } from '../src/ingest.ts';

/**
 * The same device writes two naming forms. A TF card holds
 * `ego_<serial>_<ts>/ego_<serial>_<ts>_camera_left_part0001.mp4`; EgoViewer,
 * recording over USB on firmware 0.0.13, writes
 * `Orbbec_Ego_<serial>_<ts>/Orbbec_Ego_<serial>_<ts>_camera_left.mp4` -- an
 * extra `Orbbec_` and no `_partNNNN`. Measured 2026-09-03 on the bench unit.
 * Before this test the second form quarantined as MEDIA-MISSING with every
 * file unclassified: real footage, silently lost.
 */
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'sessions');
const BASENAME = 'Orbbec_Ego_SYNTH0000003_20260813_091200';

describe('a session in the EgoViewer naming form', () => {
  it('ingests as a session with the real serial, and firmware 0.0.13 is known', async () => {
    const rec = await ingest(join(FIXTURES, 'egoviewer-form', BASENAME));
    const codes = rec.discrepancies.map((d) => d.code);

    expect(rec.state).not.toBe('quarantined');
    expect(codes).not.toContain('MEDIA-MISSING');
    expect(codes).not.toContain('EPISODE-ID-FALLBACK');
    expect(codes).not.toContain('FIRMWARE-UNKNOWN');
    expect(rec.device.serial).toBe('SYNTH0000003');
    expect(rec.device.firmware_declared).toBe('0.0.13');
    expect(Number(rec.timing.raw_duration_s)).toBeGreaterThan(0);
  });

  it('derives identity from the serial, not from `Ego`', () => {
    expect(parseSessionBasename(BASENAME)?.serial).toBe('SYNTH0000003');
    /**
     * The device prefix is not part of the identity: the same recording reached
     * by card (`ego_…`) or by EgoViewer (`Orbbec_Ego_…`) is one episode.
     */
    expect(deriveEpisodeId(BASENAME)).toBe('56fbdeca-dceb-8cb5-a5cb-c91caf0f8882');
    expect(deriveEpisodeId(BASENAME)).toBe(deriveEpisodeId('ego_SYNTH0000003_20260813_091200'));
    expect(deriveEpisodeId(BASENAME)).not.toBe(deriveEpisodeId('ego_SYNTH0000001_20260813_091200'));
  });
});
