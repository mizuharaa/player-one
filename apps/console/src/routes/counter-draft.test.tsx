// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@playerone/api/i18n';
import type { Reference } from '../lib/api.ts';

/**
 * The counter intake survives leaving the screen, and it keeps its two ids.
 *
 * This is the dangerous half of the persistence lane, and the reason it was
 * built before the bug that was actually reported. Both counter writes are
 * idempotent on an id this client mints and on nothing else: `handovers` and
 * `collection_sessions` carry a primary key and plain indexes, with no natural
 * key — `handovers_card_idx` is not unique and there is no unique on
 * `(handover_id, task_id, prepare_time)`. So before this change, an operator
 * who reloaded or clicked the top bar mid-intake came back to nine empty
 * questions AND two fresh ids, and their second attempt was not a retry. One
 * physical TF card became two handovers; one handover became two sessions.
 * Settlement pays on that attribution.
 *
 * Which is why the assertion that matters here is not "the card number came
 * back" but "the id is the same id". A test that only checked the visible
 * answers would pass with the ids still being re-minted, and the double-write
 * would survive the fix.
 */
const REFERENCE: Reference = {
  fetched_at: '2026-09-16T09:00:00.000Z',
  upload_centre_id: 'centre-1',
  reference_scope: 'global',
  collectors: [
    { id: 'c-1', externalRef: 'app:c-1', status: 'qualified', examResult: 'pass' },
    { id: 'c-2', externalRef: 'app:c-2', status: 'qualified', examResult: 'pass' },
  ],
  devices: [
    { id: 'd-1', hardwareSerial: 'EGO-0001', status: 'active', firmwareVersion: '1.0', boundCollectorId: null },
  ],
  tasks: [{ id: 't-1', name: 'Kitchen, morning', type: 'cooking', unitPrice: '1200', status: 'published' }],
  scenarios: [{ id: 's-1', code: 'kitchen', privacyRiskLevel: 'low' }],
  task_claims: [
    { id: 'cl-1', taskId: 't-1', collectorId: 'c-1', claimedAt: '2026-09-16T08:00:00.000Z', releasedAt: null },
  ],
};

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => {} },
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string) => MESSAGES.en[key as keyof typeof MESSAGES.en] ?? key,
  }),
}));

vi.mock('../components/shell/AppShell.tsx', () => ({
  AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

/** The screen renders a `<Link>` to the back office from its empty states. */
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
  useNavigate: () => () => {},
  useSearch: () => ({}),
}));

/** A signed-in operator, synchronously — the draft key is scoped to this id. */
vi.mock('../lib/profile-api.ts', () => ({
  useOperatorProfile: () => ({
    data: { operator: { id: 'op-1', external_ref: 'vng:op-1', role: 'administrator', status: 'active', centre: null } },
  }),
  signOut: async () => {},
}));

/** Every write this screen can make, recorded rather than performed. */
const sent: { handovers: { id: string; tf_card_id: string }[]; sessions: { id: string; handoverId: string }[] } = {
  handovers: [],
  sessions: [],
};

vi.mock('../lib/api.ts', async (original) => {
  const real = await original<typeof import('../lib/api.ts')>();
  return {
    ...real,
    counter: {
      ...real.counter,
      reference: async () => REFERENCE,
      handover: async (body: { id: string; tf_card_id: string }) => {
        sent.handovers.push({ id: body.id, tf_card_id: body.tf_card_id });
        return { replayed: false };
      },
      session: async (handoverId: string, body: { id: string }) => {
        sent.sessions.push({ id: body.id, handoverId });
        return { replayed: false };
      },
    },
  };
});

const { CounterScreen } = await import('./Counter.tsx');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/**
 * jsdom has no layout, and the wizard rail measures nothing, so the only shim
 * the screen asks for is `matchMedia`. `matches: false` is the desktop
 * reading, which is what a counter machine is.
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

const DRAFT_KEY = 'playerone.console.draft.op-1.counter';

async function mount() {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <CounterScreen />
      </QueryClientProvider>,
    );
  });
  // Retried rather than slept: a fixed delay measures the runner under load.
  await vi.waitFor(async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(host.textContent ?? '').toContain(MESSAGES.en['counter.step.collector']);
  });
  const unmount = async () => {
    await act(async () => root.unmount());
    host.remove();
    client.clear();
  };
  return { host, unmount };
}

/** The card field, by the label the operator reads. */
function cardInput(host: HTMLElement): HTMLInputElement | null {
  for (const input of host.querySelectorAll('input')) {
    const label = input.closest('label')?.textContent ?? '';
    if (label.includes(MESSAGES.en['counter.q.card'] ?? '') || label.includes('card') || label.includes('Card')) {
      return input as HTMLInputElement;
    }
  }
  return null;
}

function held(): { savedAt: number; value: Record<string, unknown> } | null {
  const raw = sessionStorage.getItem(DRAFT_KEY);
  return raw === null ? null : (JSON.parse(raw) as { savedAt: number; value: Record<string, unknown> });
}

beforeEach(() => {
  sessionStorage.clear();
  sent.handovers = [];
  sent.sessions = [];
});

describe('the counter intake, across an unmount', () => {
  /**
   * The whole point. Mount, answer, unmount, mount again — and the two ids
   * have to be the ids the operator started with.
   *
   * It drives the draft through the store rather than through twelve
   * simulated clicks: what is under test is that the screen *reads* a held
   * intake and adopts its ids, and a test that had to walk the wizard would be
   * testing the wizard. The write side is asserted separately below, against
   * the real component, so both halves of the round trip are covered.
   */
  it('adopts the ids from a held draft instead of minting new ones', async () => {
    const first = await mount();
    const before = held();
    expect(before, 'the screen saves an intake as soon as it can').not.toBeNull();
    const originalHandover = before!.value['handoverId'] as string;
    const originalSession = before!.value['sessionId'] as string;
    expect(originalHandover).toMatch(/^[0-9a-f-]{36}$/);
    await first.unmount();

    // The operator had typed a card number and picked a collector.
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        value: { ...before!.value, collectorId: 'c-1', deviceId: 'd-1', card: 'TF-0041', step: 2 },
      }),
    );

    const second = await mount();
    const after = held();
    expect(after!.value['handoverId'], 'a remount must not mint a second handover id').toBe(originalHandover);
    expect(after!.value['sessionId'], 'a remount must not mint a second session id').toBe(originalSession);
    expect(after!.value['card'], 'the operator’s typing came back').toBe('TF-0041');
    expect(second.host.textContent ?? '', 'a restore has to be visible').toContain(
      MESSAGES.en['draft.restored'],
    );
    await second.unmount();
  });

  /** The answers come back on the face of the screen, not just in storage. */
  it('puts the typed card number back into the form', async () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        value: {
          handoverId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          landed: false,
          collectorId: 'c-1',
          deviceId: 'd-1',
          card: 'TF-0041',
          handoverAt: '2026-09-16T09:00',
          taskId: null,
          scenarioId: null,
          preparedAt: '2026-09-16T09:05',
          others: null,
          sensitive: null,
          step: 2,
        },
      }),
    );
    const { host, unmount } = await mount();
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(cardInput(host)?.value, 'the card number is back in its field').toBe('TF-0041');
    });
    await unmount();
  });

  /**
   * A draft from a fortnight ago is not offered.
   *
   * This is the bound on keeping the id: an id whose handover the database
   * decided long ago would replay into a row nobody remembers, so an old draft
   * is dropped and the screen mints fresh ids like any other new intake.
   */
  it('ignores a draft older than a day and mints fresh ids', async () => {
    sessionStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        savedAt: Date.now() - 25 * 60 * 60 * 1000,
        value: { handoverId: 'stale-id', sessionId: 'stale-id-2', landed: false, card: 'TF-OLD', step: 4 },
      }),
    );
    const { host, unmount } = await mount();
    expect(held()!.value['handoverId']).not.toBe('stale-id');
    expect(held()!.value['card']).toBe('');
    expect(host.textContent ?? '', 'nothing was restored, so nothing is announced').not.toContain(
      MESSAGES.en['draft.restored'],
    );
    await unmount();
  });

  /** One operator's intake is not offered to the next one on the same machine. */
  it('does not offer another operator’s intake', async () => {
    sessionStorage.setItem(
      'playerone.console.draft.op-2.counter',
      JSON.stringify({ savedAt: Date.now(), value: { handoverId: 'op2-id', card: 'TF-THEIRS', step: 3 } }),
    );
    const { host, unmount } = await mount();
    expect(held()!.value['handoverId']).not.toBe('op2-id');
    expect(host.textContent ?? '').not.toContain('TF-THEIRS');
    await unmount();
  });

  /** Nothing an intake saves may be a credential or a payment detail. */
  it('saves no forbidden field', async () => {
    const { unmount } = await mount();
    const serialised = JSON.stringify(held());
    for (const banned of ['token', 'password', 'account_no', 'bank_code', 'typed', 'reference']) {
      expect(serialised, `an intake draft must not carry ${banned}`).not.toContain(banned);
    }
    await unmount();
  });

  it('submits with restored ids and leaves no completed draft to replay', async () => {
    const handoverId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ savedAt: Date.now(), value: {
      handoverId, sessionId, landed: false, collectorId: 'c-1', deviceId: 'd-1',
      card: 'TF-0041', handoverAt: '2026-09-16T09:00', taskId: 't-1', scenarioId: 's-1',
      preparedAt: '2026-09-16T09:05', others: false, sensitive: false, step: 6,
    } }));
    const { host, unmount } = await mount();
    const submit = [...host.querySelectorAll('button')].find((button) => button.textContent === MESSAGES.en['counter.commit']);
    expect(submit?.disabled).toBe(false);
    await act(async () => submit!.click());
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
      expect(held()).toBeNull();
    });
    expect(sent.handovers).toEqual([{ id: handoverId, tf_card_id: 'TF-0041' }]);
    expect(sent.sessions).toEqual([{ id: sessionId, handoverId }]);
    await unmount();
  });
});
