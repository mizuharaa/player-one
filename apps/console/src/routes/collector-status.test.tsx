// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { LOCALES, MESSAGES } from '@playerone/api/i18n';
import { BO_COLLECTOR_STATUSES, type BoCollector } from '../lib/api.ts';

/**
 * The console's vocabulary of collector statuses, against the database's.
 *
 * Migration 0034 added `prospect` — somebody who signed up in the app and has
 * not been to a collection centre — and the counter screens were left behind.
 * Three surfaces broke at once, and all three are here: `Counter.tsx` and
 * `TaskAssign.tsx` render `t('bo.collector.status.' + status)` straight from
 * live reference data, and i18next is initialised with no
 * `parseMissingKeyHandler`, so a missing sentence renders as the literal key on
 * an operator's screen. `BackOffice.tsx`'s row `<select>` built its options
 * from a hard-coded list of three, so a prospect row matched no option and the
 * cell drew with nothing selected — an operator could not see what the row
 * said, and changing it meant guessing.
 *
 * The fix that keeps it fixed is one list: `BO_COLLECTOR_STATUSES` is the
 * console's copy of `collectors_status_check`, the `BoCollector['status']`
 * union derives from it, and the row select maps over it. So a fifth status
 * fails this file rather than a counter.
 */
describe('the statuses an operator can be shown', () => {
  it('has a sentence for every one of them, in every locale', () => {
    for (const locale of LOCALES) {
      for (const status of BO_COLLECTOR_STATUSES) {
        const key = `bo.collector.status.${status}`;
        const sentence = MESSAGES[locale][key as keyof (typeof MESSAGES)[typeof locale]];
        // Not just present: a sentence equal to its own key is what the missing
        // handler would have rendered anyway.
        expect(sentence, `${locale} is missing ${key}`).toBeTruthy();
        expect(sentence).not.toBe(key);
      }
    }
  });

  /**
   * `prospect` is readable and liftable, and is not something an operator may
   * type. The create form keeps its own three values (BO-03 enrols a person an
   * operator has met) and `CollectorBody`/`CollectorPatch` in the API refuse
   * it, so this list is about what can be SHOWN and lifted, not about what can
   * be invented at a counter.
   */
  it('covers the four the database allows, prospect included', () => {
    expect([...BO_COLLECTOR_STATUSES]).toEqual(['prospect', 'pending', 'qualified', 'suspended']);
  });
});

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => MESSAGES.en[key as keyof typeof MESSAGES.en] ?? key,
  }),
}));

/**
 * The shell, out of the way. Importing it pulls `lib/i18n.ts`, which calls
 * `i18n.init()` at module scope — the app's real locale machinery, which this
 * file is deliberately not testing: the `t` above is what turns a status into
 * the sentence, and `MESSAGES` is the same catalogue the app loads.
 */
vi.mock('../components/shell/AppShell.tsx', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

const PROSPECT: BoCollector = {
  id: 'c-prospect',
  external_ref: 'app:c-prospect',
  status: 'prospect',
  exam_result: null,
  exam_decided_at: null,
  agreements: [],
  payout_account: null,
};

vi.mock('../lib/api.ts', async (original) => {
  const real = await original<typeof import('../lib/api.ts')>();
  return {
    ...real,
    backOffice: { ...real.backOffice, collectors: async () => ({ collectors: [PROSPECT] }) },
  };
});

const { Collectors } = await import('./BackOffice.tsx');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * The row itself, rendered. The two assertions are the two halves of the
 * defect: the word an operator reads, and a `<select>` that is actually on the
 * value the row carries.
 */
it('draws a prospect row with the word and with its own option selected', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <Collectors onRefused={() => {}} />
      </QueryClientProvider>,
    ),
  );
  // Retried rather than slept: a fixed 10 ms measures the runner under load.
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    expect(host.textContent ?? '').toContain(MESSAGES.en['bo.collector.status.prospect']);
  });

  const text = host.textContent ?? '';
  expect(text).toContain(MESSAGES.en['bo.collector.status.prospect']);
  // The raw key is what an operator saw before this change.
  expect(text).not.toContain('bo.collector.status.');

  const select = host.querySelector('select');
  expect(select).not.toBeNull();
  expect(select!.value).toBe('prospect');
  expect([...select!.options].map((o) => o.value)).toContain('prospect');

  await act(async () => root.unmount());
  host.remove();
  client.clear();
});
