import * as React from 'react';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@playerone/api/i18n';
import { api, ApiError } from '../lib/api.ts';
import { LoadFailed, RefusedBanner } from '../payout/pieces.tsx';

vi.mock('react-i18next', async (importOriginal) => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../components/shell/AppShell.tsx', () => ({ AppShell: () => null }));
vi.stubGlobal('React', React);

describe('the operator can report the server failure reference', () => {
  const internal = new ApiError(500, 'internal', undefined, undefined, { error: 'internal', ref: 'req-abc' });
  const refusal = new ApiError(409, 'refused', 'task_commitments_insert_active', 'task_commitments_insert_active');

  it('keeps the reference on a 500 and leaves a 409 without one', () => {
    expect(internal.ref).toBe('req-abc');
    expect(refusal.ref).toBeUndefined();
  });

  it('renders the query failure reference in the shared Problem', () => {
    expect(renderToStaticMarkup(createElement(LoadFailed, { error: internal }))).toContain('req-abc');
    expect(renderToStaticMarkup(createElement(LoadFailed, { error: refusal }))).not.toContain('bo.error.reference');
  });

  it('renders the caught mutation reference in the refusal banner', () => {
    expect(renderToStaticMarkup(createElement(RefusedBanner, { error: internal, onDismiss: () => {} }))).toContain('req-abc');
    expect(renderToStaticMarkup(createElement(RefusedBanner, { error: refusal, onDismiss: () => {} }))).not.toContain('bo.error.reference');
  });

  /**
   * Home's own request, which is the one that was losing the reference.
   *
   * `/api/review/shift` was fetched inline in `Home.tsx` and its `ApiError` was
   * built from the status line alone, so a 500 that named itself arrived at
   * `<Problem>` with `ref === undefined`. It goes through `call` now like every
   * other request on this seam, and this case fails if anyone writes a second
   * transport for it.
   */
  it('carries the 500 reference off the shift request itself', async () => {
    let requested: unknown;
    vi.stubGlobal('fetch', async (path: unknown) => {
      requested = path;
      return new Response(JSON.stringify({ error: 'internal', ref: 'req-shift-1' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      const caught = await api.shift().then(
        () => null,
        (e: unknown) => e,
      );
      expect(caught).toBeInstanceOf(ApiError);
      expect((caught as ApiError).status).toBe(500);
      expect((caught as ApiError).ref).toBe('req-shift-1');
      expect(requested).toBe('/api/review/shift');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('has a sentence in all three languages for every corrective commitment refusal', () => {
    for (const name of [
      'tasks_commitment_shape_check',
      'task_commitments_abandon_reason_check',
      'task_commitments_terms_immutable',
      'task_commitments_insert_active',
      'task_commitments_no_delete',
    ]) {
      const key = `bo.refused.${name}` as keyof typeof MESSAGES.en;
      for (const locale of ['en', 'zh', 'vi'] as const) {
        expect(MESSAGES[locale][key], `${name} needs a ${locale} sentence`).toBeTruthy();
      }
      expect(MESSAGES.zh[key]).not.toBe(MESSAGES.en[key]);
      expect(MESSAGES.vi[key]).not.toBe(MESSAGES.en[key]);
    }
  });
});
