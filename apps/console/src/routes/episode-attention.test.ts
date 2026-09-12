// @vitest-environment jsdom
// The module under test reaches `AppShell`, which reaches `lib/i18n.ts`,
// which reads `localStorage` while it is being imported. Nothing here uses
// the DOM; jsdom is only what makes that import legal.
/**
 * The two pieces of `/episodes/attention` that a screenshot cannot check.
 *
 * Both attention scopes are empty on the console seed — `/episodes/stuck`
 * returns no rows and the seed's batches have nothing blocking — so the tables,
 * the filters and the refusal path never appear in a shot. These are the two
 * bits of that code with a branch in them, and both decide something an
 * operator acts on.
 */
import { describe, expect, it } from 'vitest';
import { MESSAGES } from '@playerone/api/i18n';
import { ApiError } from '../lib/api.ts';
import { episodeRefusal, holdKey, stamp } from './EpisodeAttention.tsx';

describe('a refusal on the episode lane', () => {
  it('does not tell an operator a bill is missing when an episode is', () => {
    /* The shared payout function answers `settle.gone` here, which names a
       bill. This screen has no bills on it. */
    expect(episodeRefusal(new ApiError(404, 'no such episode'))).toBe('episodes.gone');
  });

  it('keeps every other answer the shared function gives', () => {
    expect(episodeRefusal(new ApiError(409, 'refused', 'payout_risk_hold'))).toBe(
      'bo.refused.payout_risk_hold',
    );
    /* The two 409s this route raises name no constraint, so they land on the
       generic refusal rather than on a sentence invented for them here. */
    expect(episodeRefusal(new ApiError(409, 'that session does not belong to this delivery'))).toBe(
      'bo.refused.unknown',
    );
    expect(episodeRefusal(new TypeError('fetch failed'))).toBe('settle.failed');
  });

  it('names a sentence that exists in every locale', () => {
    for (const key of ['episodes.gone', 'bo.refused.unknown', 'settle.failed'] as const) {
      for (const locale of ['en', 'zh', 'vi'] as const) {
        expect(MESSAGES[locale][key], `${locale} ${key}`).toBeTruthy();
      }
    }
  });
});

describe('the hold filter', () => {
  const park = { park_id: 'p', reason: null, parked_at: 'x', parked_by: null, release_with: 'r' };
  const held = { review_id: 'r', held_at: 'x', release_with: 'r' };

  it('names each hold on its own', () => {
    expect(holdKey({ park, held: null })).toBe('parked');
    expect(holdKey({ park: null, held })).toBe('held');
  });

  it('keeps a row that carries both visible under either chip', () => {
    const both = holdKey({ park, held });
    expect(both).toContain('parked');
    expect(both).toContain('held');
  });
});

describe('the session-start column', () => {
  /* `episodes.session_started_at` is text from the directory basename, not an
     instant. Reading it with `new Date()` printed a dash on every row. */
  it('reads the basename stamp the server actually sends', () => {
    expect(stamp('20260813_072415')).toBe('2026-08-13 07:24');
  });

  it('prints an unrecognised value as it came, rather than hiding it', () => {
    expect(stamp('2026-08-13T07:24:15.000Z')).toBe('2026-08-13T07:24:15.000Z');
    expect(stamp(null)).toBe('—');
  });
});
