// @vitest-environment jsdom
import * as SecureStore from 'expo-secure-store';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { DEFAULT_LOCALE, MESSAGES } from '../src/i18n.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { NavProvider } from '../src/nav.tsx';
import { ThemeProvider } from '../src/theme.tsx';
import { dong, vnd } from '../src/money.ts';

vi.mock('react-native', async () => ({ ...(await import('react-native-web')) }));
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({}) }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('react-native-svg', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  return { default: Stub, Svg: Stub, Circle: Stub, Rect: Stub, Path: Stub, Line: Stub, G: Stub };
});

/**
 * The keystore, in memory.
 *
 * Preferences and recent searches are the only things this screen persists, and
 * asserting that they are written is the point of two of the tests below — so
 * this stub is a real map rather than a no-op.
 */
const store = new Map<string, string>();
/**
 * Gates over the keystore, so the two races can be driven deliberately.
 *
 * `holdReads` makes every read wait on a promise the test resolves, which is
 * how the hydration race is reproduced; `holdWrites` does the same for writes,
 * which is how a write is still in flight when the clear is called.
 */
type Gate = 'read' | 'write';
const closed: Record<Gate, boolean> = { read: false, write: false };
const parked: { kind: Gate; go: () => void }[] = [];

const gate = (kind: Gate): Promise<void> =>
  closed[kind] ? new Promise<void>((resolve) => { parked.push({ kind, go: resolve }); }) : Promise.resolve();

/** Let everything parked on this gate through, and leave the gate open. */
const release = (kind: Gate) => {
  closed[kind] = false;
  for (const entry of parked.splice(0, parked.length)) {
    if (entry.kind === kind) entry.go();
    else parked.push(entry);
  }
};

vi.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => {
    await gate('read');
    return store.get(key) ?? null;
  },
  setItemAsync: async (key: string, value: string) => {
    await gate('write');
    store.set(key, value);
  },
  deleteItemAsync: async (key: string) => { store.delete(key); },
}));

const { TaskHall, clearPreferences } = await import('../src/screens/TaskHall.tsx');
const { GuideProvider } = await import('../src/guide/Guide.tsx');

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The catalogue this screen will actually print; see onboarding-cards.test.tsx. */
const m = MESSAGES[DEFAULT_LOCALE];

let host: HTMLDivElement;
let root: Root;
let client: QueryClient;
let api: MockCollectorApi;

const page = (): string => document.body.textContent ?? '';

const controls = (): HTMLElement[] => [
  ...document.body.querySelectorAll<HTMLElement>(
    '[role="button"], [role="radio"], [role="switch"], [role="checkbox"], [role="search"], [role="slider"]',
  ),
];

const named = (name: string): HTMLElement | undefined =>
  controls().find((node) => (node.getAttribute('aria-label') ?? '').trim() === name);

const input = (): HTMLInputElement => {
  const field = document.body.querySelector<HTMLInputElement>('input');
  if (field === null) throw new Error('no text input on screen');
  return field;
};

/**
 * Type into the overlay's field.
 *
 * The value goes in through `HTMLInputElement`'s own setter before the event is
 * dispatched: React tracks the last value it wrote on a controlled input and
 * skips the change when the DOM property is assigned directly, so setting
 * `.value` alone looks like typing and changes nothing.
 */
async function type(text: string) {
  const field = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The id the mock hands out, which is what both stores are keyed by. */
async function collectorId(): Promise<string> {
  const me = await api.profile();
  if (me === null) throw new Error('no profile: register first');
  return me.id;
}

async function mount() {
  // Preferences and recents are keyed per collector, and `MockCollectorApi`
  // has no profile until somebody registers — so a screen mounted without this
  // would persist nothing and the two keystore assertions below would be
  // asserting the mock's emptiness rather than this screen's behaviour. On a
  // phone the profile is always there: the session was restored to reach here.
  await api.register('Nguyễn Thị Mai', '0901234567');

  await act(async () =>
    root.render(
      <ThemeProvider>
        <LocaleProvider>
          <ApiProvider value={api}>
            <QueryClientProvider client={client}>
              <NavProvider initial={{ name: 'taskHall' }}>
                <GuideProvider>
                  <TaskHall />
                </GuideProvider>
              </NavProvider>
            </QueryClientProvider>
          </ApiProvider>
        </LocaleProvider>
      </ThemeProvider>,
    ),
  );
  // Let the task and profile queries settle, then the keystore reads they gate.
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  store.clear();
  closed.read = false;
  closed.write = false;
  parked.length = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api = new MockCollectorApi();
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  client.clear();
});

it('prints the rate the server sent and never a total', async () => {
  await mount();

  // The three seeded tasks, each with its own unit price, rendered from the
  // server's own decimal string through `dong` and nothing else.
  expect(page()).toContain(`${vnd('1200')} ${m['hall.perMinute']}`);
  expect(page()).toContain(`${vnd('1000')} ${m['hall.perMinute']}`);
  expect(page()).toContain(`${vnd('1500')} ${m['hall.perMinute']}`);
  expect(page()).toContain(m['hall.perMinute']);

  // 1200 x 3000 = 3,600,000 — the projection this screen must never show.
  // Nor the other two tasks' products.
  for (const projection of [vnd('3600000'), vnd('6000000'), vnd('13500000')]) {
    expect(page()).not.toContain(projection);
  }
});

it('prints the server target and remaining slots on the card meta line', async () => {
  await mount();

  expect(page()).toContain(`50 ${m['taskCard.hours']}`);
  const task = (await api.tasks())[0]!;
  expect(page()).toContain(m['taskCard.slots'].replace('{count}', String(task.remainingSlots)));
});

it('opens the search overlay, filters on what was typed, and remembers the term', async () => {
  await mount();

  await act(async () => named(m['explore.searchOpen'])!.click());
  await type('kho');
  // "Sắp xếp kho hàng" matches; the other two do not.
  expect(page()).toContain('Sắp xếp kho hàng');
  expect(page()).not.toContain('Nấu ăn tại nhà');

  // Submitting records the term, and it comes back as a recent search.
  await act(async () => {
    // `keydown`, which is what `react-native-web` turns into
    // `onSubmitEditing`; a `keypress` reaches nothing.
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await act(async () => { await Promise.resolve(); });
  const recents = [...store.entries()].find(([key]) => key.endsWith('.recents'));
  expect(recents?.[1]).toContain('kho');
});

it('filters on a saved preference and writes it to the keystore', async () => {
  await mount();

  await act(async () => named(m['explore.filters'])!.click());
  await act(async () => named(m['explore.prefsTitle'])!.click());

  // Pick one place to record, then save. The slider is not driven here:
  // `onAccessibilityAction` is a native trait and `react-native-web` does not
  // implement it, so a drag or an increment is Fable's device pass. The chip
  // grid is a plain pressable and is the half this harness can prove.
  await act(async () => named(m['scenario.warehouse'])!.click());
  await act(async () => named(m['explore.savePrefs'])!.click());
  await act(async () => { await Promise.resolve(); });

  // On disk, under this collector's own key — not only in the screen's state.
  const saved = [...store.entries()].find(([key]) => !key.endsWith('.recents'));
  expect(saved?.[0]).toContain('playerone.collector.prefs.');
  expect(saved?.[1]).toContain('warehouse');

  // And the list obeys it: only the warehouse task survives.
  expect(page()).toContain('Sắp xếp kho hàng');
  expect(page()).not.toContain('Nấu ăn tại nhà');
});

it('clears one collector on logout and leaves the other alone', async () => {
  // Work order §9.4: scoped per account, and cleared on logout.
  store.set('playerone.collector.prefs.col-a', JSON.stringify({ maxMinutes: 1000, scenarios: ['home'] }));
  store.set('playerone.collector.prefs.col-a.recents', JSON.stringify(['kho']));
  store.set('playerone.collector.prefs.col-b', JSON.stringify({ maxMinutes: null, scenarios: ['office'] }));
  store.set('playerone.collector.prefs.col-b.recents', JSON.stringify(['office']));

  await clearPreferences('col-a');

  expect(store.has('playerone.collector.prefs.col-a')).toBe(false);
  expect(store.has('playerone.collector.prefs.col-a.recents')).toBe(false);
  // The next collector on this phone keeps their own.
  expect(store.has('playerone.collector.prefs.col-b')).toBe(true);
  expect(store.has('playerone.collector.prefs.col-b.recents')).toBe(true);
});

it('does not let a write that was in flight survive the clear', async () => {
  await mount();

  // Hold writes, then save — the write is now parked inside the keystore.
  closed.write = true;
  await act(async () => named(m['explore.filters'])!.click());
  await act(async () => named(m['explore.prefsTitle'])!.click());
  await act(async () => named(m['scenario.warehouse'])!.click());
  await act(async () => named(m['explore.savePrefs'])!.click());
  expect([...store.keys()].some((key) => !key.endsWith('.recents'))).toBe(false);

  // Sign out while it is still parked, then let it through. The clear is
  // queued behind the write, so the write lands and the delete lands after it.
  const cleared = clearPreferences(await collectorId());
  release('write');
  await act(async () => { await cleared; });

  expect([...store.keys()]).toEqual([]);
});

it('lets a change made before hydration finishes win', async () => {
  // A collector who has used this phone before, so there is something stored
  // that could come back and overwrite them. `mount` registers, so the id has
  // to exist before it: register here and let `mount`'s own call be a no-op
  // over the same identity.
  await api.register('Nguyễn Thị Mai', '0901234567');
  const id = await collectorId();
  store.set(`playerone.collector.prefs.${id}`, JSON.stringify({ maxMinutes: null, scenarios: ['office'] }));

  closed.read = true;
  await mount();

  // The read is parked. Choose a different place to record and save.
  await act(async () => named(m['explore.filters'])!.click());
  await act(async () => named(m['explore.prefsTitle'])!.click());
  await act(async () => named(m['scenario.warehouse'])!.click());
  await act(async () => named(m['explore.savePrefs'])!.click());

  // Now the stored value arrives. It must not replace the choice just made.
  release('read');
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

  expect(page()).toContain('Sắp xếp kho hàng');
  expect(page()).not.toContain('Làm việc văn phòng');
});

it('offers a named Refresh, a skeleton while loading, and Retry on a failure', async () => {
  // Loading: the skeleton is on screen and the grid is not.
  closed.read = false;
  const slow = vi.spyOn(api, 'tasks').mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve([]), 50)),
  );
  await act(async () =>
    root.render(
      <ThemeProvider>
        <LocaleProvider>
          <ApiProvider value={api}>
            <QueryClientProvider client={client}>
              <NavProvider initial={{ name: 'taskHall' }}>
                <GuideProvider>
                  <TaskHall />
                </GuideProvider>
              </NavProvider>
            </QueryClientProvider>
          </ApiProvider>
        </LocaleProvider>
      </ThemeProvider>,
    ),
  );
  // The skeleton grid is on screen and says so, and the empty state is not:
  // an empty list while a read is in flight reads as "there is no work".
  expect(document.body.querySelector('[aria-label="' + m['common.loading'] + '"]')).not.toBeNull();
  expect(page()).not.toContain(m['explore.emptyTitle']);

  slow.mockRestore();
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 60)); });

  // Refresh is a named control, and it re-reads the hall.
  const refresh = named(m['explore.refresh']);
  expect(refresh).toBeDefined();
  const again = vi.spyOn(api, 'tasks');
  await act(async () => refresh!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(again).toHaveBeenCalled();
});

it('offers Retry inline when a refresh fails over data already on screen', async () => {
  await mount();
  expect(page()).toContain('Nấu ăn tại nhà');

  vi.spyOn(api, 'tasks').mockRejectedValue(new Error('offline'));
  await act(async () => named(m['explore.refresh'])!.click());
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });

  // The data stays, the failure is inline, and it carries a way out.
  expect(page()).toContain('Nấu ăn tại nhà');
  expect(page()).toContain(m['common.refreshFailed']);
  expect(named(m['common.retry'])).toBeDefined();
});

it('offers a way out of a filter that matches nothing', async () => {
  await mount();

  await act(async () => named(m['explore.searchOpen'])!.click());
  await type('zzzz');
  expect(page()).toContain(m['hall.noMatches']);

  await act(async () => named(m['common.cancel'])!.click());
  // Back on the grid, with the same term still applied: the empty state is the
  // bold headline, the line, and one CTA that clears what caused it.
  expect(page()).toContain(m['explore.emptyTitle']);
  const clear = named(m['explore.emptyAction']);
  expect(clear).toBeDefined();
  await act(async () => clear!.click());
  expect(page()).toContain('Nấu ăn tại nhà');
});

vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: () => ({ remove() {} }) }));
vi.mock('react-native-safe-area-context', async () => ({ initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null) }));

it('reports a failed local deletion and lets the same collector retry it', async () => {
  store.set('playerone.collector.prefs.col-a', '{}');
  const remove = vi.spyOn(SecureStore, 'deleteItemAsync').mockRejectedValueOnce(new Error('keystore unavailable'));
  try {
    await expect(clearPreferences('col-a')).rejects.toThrow('keystore unavailable');
    expect(store.has('playerone.collector.prefs.col-a')).toBe(true);
    await clearPreferences('col-a');
    expect(store.has('playerone.collector.prefs.col-a')).toBe(false);
  } finally { remove.mockRestore(); }
});

it('renders a seeded task title, exact price and type badge in the shared card', async () => {
  const { TaskCard } = await import('../src/ui/TaskCard.tsx');
  const seed = { ...(await api.tasks())[0]!, title: 'Office task', type: 'office', unitPriceVndPerMinute: '1234.5678' };
  await act(async () => root.render(<ThemeProvider><LocaleProvider><TaskCard task={seed} onPress={() => {}} /></LocaleProvider></ThemeProvider>));
  expect(page()).toContain('Office task');
  expect(page()).toContain(`${vnd('1234.5678')} ${m['hall.perMinute']}`);
  expect(page()).toContain(m['taskCard.home']);
});

it.each([120, 121, 3000])('formats a server duration of %s minutes without losing the remainder', async targetMinutes => {
  const { TaskCard } = await import('../src/ui/TaskCard.tsx');
  const seed = { ...(await api.tasks())[0]!, targetMinutes };
  await act(async () => root.render(<ThemeProvider><LocaleProvider><TaskCard task={seed} onPress={() => {}} /></LocaleProvider></ThemeProvider>));
  const expected = targetMinutes === 120 ? `120 ${m['detail.minutes']}` : targetMinutes === 121 ? `2 ${m['taskCard.hours']} 1 ${m['detail.minutes']}` : `50 ${m['taskCard.hours']}`;
  expect(page()).toContain(expected);
});
