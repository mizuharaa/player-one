// @vitest-environment jsdom
/**
 * The row that had no screen.
 *
 * `GET /upload-batches/:id/exceptions` answers two independent populations,
 * and until this test existed the console read only one of them. `blocking` is
 * about attribution — nobody owns this episode — and `unusable` is about the
 * footage: the ingest is `quarantined`, so `eligible` in review.ts will never
 * hand it to a reviewer, and the episode is unpayable however well attributed
 * it is. At the demo rehearsal two broken recordings resolved
 * `automatic_single` and the panel showed nothing at all.
 *
 * So this renders the panel and asserts the two things an operator acts on:
 * that the row is there, and that it says which defects made the recording
 * unusable rather than the bare word "quarantined".
 */
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { LOCALES, MESSAGES } from '@playerone/api/i18n';
import type { BatchExceptions, BatchRow } from '../lib/api.ts';

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => MESSAGES.en[key as keyof typeof MESSAGES.en] ?? key,
  }),
}));

/** The shell out of the way: importing the real one initialises i18next. */
vi.mock('../components/shell/AppShell.tsx', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const BATCH: BatchRow = {
  id: 'b0000000-0000-4000-8000-000000000001',
  handoverId: 'h0000000-0000-4000-8000-000000000001',
  batchStatus: 'verified',
  importStartedAt: '2026-09-15T05:00:00.000Z',
  importCompletedAt: '2026-09-15T05:00:10.000Z',
  resolved: 2,
  quarantined: 0,
};

/** One broken recording and nothing unattributed: the rehearsal's own shape. */
const EXCEPTIONS: BatchExceptions = {
  batch_id: BATCH.id,
  summary: {
    episodes: 2,
    sessions: 1,
    quarantined: 0,
    awaiting_confirmation: 0,
    parked: 0,
    unusable: 1,
    episodes_per_session: 2,
  },
  blocking: [],
  unusable: [
    {
      episode_id: 'e0000000-0000-4000-8000-00000000abcd',
      session_started_at: '20260914_025643',
      resolution_state: 'resolved',
      ingest_state: 'quarantined',
      defects: ['MEDIA-UNREADABLE', 'PTS-EMPTY', 'STREAM-SKEW-HIGH'],
    },
  ],
  sessions: [],
};

vi.mock('../lib/api.ts', async (original) => {
  const real = await original<typeof import('../lib/api.ts')>();
  return {
    ...real,
    episodes: {
      ...real.episodes,
      batches: async () => ({ batches: [BATCH] }),
      exceptions: async () => EXCEPTIONS,
      stuck: async () => ({ episodes: [] }),
    },
  };
});

const { EpisodeAttentionScreen } = await import('./EpisodeAttention.tsx');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom has no `matchMedia`, and the filter row asks for one to decide whether
 * it draws as a sheet. Desktop, so the chips and the table render inline.
 */
window.matchMedia = ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList) as typeof window.matchMedia;

describe('the attention panel with an unusable recording on it', () => {
  it('draws the row, and names the defects rather than the verdict', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <EpisodeAttentionScreen />
        </QueryClientProvider>,
      ),
    );
    /*
     * A fixed sleep here measured the runner, not the code: one CI run of
     * 4a1f142 reported "the unusable episode has no row" while three runs of
     * the same tree passed alone. `vi.waitFor` is what the payout tests in
     * this app already use for the same wait.
     */
    const findRow = () =>
      [...host.querySelectorAll('tbody tr')].find((tr) =>
        (tr.textContent ?? '').includes(EXCEPTIONS.unusable[0]!.episode_id),
      );
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(findRow(), 'the unusable episode has no row in the attention panel').toBeDefined();
    });

    /*
     * The row, found by the episode id. Before this change the first panel
     * read `blocking` alone, which is empty here, so there was no row at all
     * and the panel drew its empty state.
     */
    const row = findRow();

    const line = row!.textContent ?? '';
    // Honest, and distinct from the unattributed case: this episode has a
    // session, so "A session to attribute it to" would be a lie about it.
    expect(line).toContain(MESSAGES.en['episodes.needs.unusable']);
    expect(line).not.toContain(MESSAGES.en['episodes.needs.assignment']);
    // The evidence, in the order the server sent it.
    expect(line).toContain('MEDIA-UNREADABLE, PTS-EMPTY, STREAM-SKEW-HIGH');
    // The attribution the episode really has, not a quarantine it does not.
    expect(line).toContain('resolved');

    // And the count, next to the attribution ones it must not be confused with.
    expect(host.textContent ?? '').toContain(MESSAGES.en['episodes.summary.unusable']);

    await act(async () => root.unmount());
    host.remove();
    client.clear();
  });

  it('has a sentence for the new row in every locale', () => {
    for (const key of ['episodes.needs.unusable', 'episodes.summary.unusable'] as const) {
      for (const locale of LOCALES) {
        const sentence = MESSAGES[locale][key];
        expect(sentence, `${locale} is missing ${key}`).toBeTruthy();
        expect(sentence).not.toBe(key);
      }
    }
  });
});
