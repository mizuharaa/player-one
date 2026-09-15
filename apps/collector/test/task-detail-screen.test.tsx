// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { AGREEMENTS } from '../src/api/types.ts';
import { DEFAULT_LOCALE, MESSAGES } from '../src/i18n.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { NavProvider, useNav } from '../src/nav.tsx';
import { ThemeProvider } from '../src/theme.tsx';
import { dong } from '../src/money.ts';

vi.mock('react-native', async () => ({ ...(await import('react-native-web')) }));
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({}) }));
vi.mock('expo-image', () => ({ Image: () => null }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
vi.mock('react-native-svg', () => {
  const Stub = ({ children }: { children?: ReactNode }) => <span>{children}</span>;
  return { default: Stub, Svg: Stub, Circle: Stub, Rect: Stub, Path: Stub, Line: Stub, G: Stub };
});

const { TaskDetail } = await import('../src/screens/TaskDetail.tsx');

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

const named = (name: string): HTMLElement | undefined =>
  [...document.body.querySelectorAll<HTMLElement>('[role="button"]')].find(
    (node) => (node.getAttribute('aria-label') ?? '').trim() === name,
  );

/**
 * What `App.tsx`'s `Current` does: render the screen the route names.
 *
 * Without it, accepting a task pushes `myTasks` and this screen re-renders on
 * a route it is not for, which `useRoute` correctly refuses. That is a harness
 * artefact of mounting one screen on its own, not a fault in the screen.
 */
function OnlyOnDetail() {
  const { route } = useNav();
  return route.name === 'taskDetail' ? <TaskDetail /> : null;
}

/** Take the collector through the gates the server puts before a claim. */
async function qualify() {
  await api.register('Nguyễn Thị Mai', '0901234567');
  await api.acceptAgreements(AGREEMENTS.map((a) => ({ agreementId: a.id, version: a.version })));
  await api.completeTraining();
  await api.submitExam([true, true, true]);
}

async function mount(taskId = 'task-cook') {
  await act(async () =>
    root.render(
      <ThemeProvider>
        <LocaleProvider>
          <ApiProvider value={api}>
            <QueryClientProvider client={client}>
              <NavProvider initial={{ name: 'taskDetail', taskId }}>
                <OnlyOnDetail />
              </NavProvider>
            </QueryClientProvider>
          </ApiProvider>
        </LocaleProvider>
      </ThemeProvider>,
    ),
  );
  // Three queries settle before this screen has anything to say, and react
  // query resolves them over more than one microtask — a macrotask is what
  // `guidance-flow.test.tsx` uses for the same reason.
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
}

beforeEach(() => {
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

it('shows only the rates the server sent, and never a projected total', async () => {
  await qualify();
  await mount();

  expect(page()).toContain(m['detail.rates']);
  // The rate as sent, and each count as sent.
  expect(page()).toContain(dong('1200'));
  expect(page()).toContain(`3000 ${m['detail.minutes']}`);
  expect(page()).toContain(`420 ${m['detail.minutes']}`);
  // 1200 x 3000 = 3,600,000. The one figure this screen must never print, in
  // any of the shapes `vnd` can produce it.
  expect(page()).not.toContain('3.600.000');
  expect(page()).not.toContain('3600000');
  // And it says why there is no total rather than leaving the gap unexplained.
  expect(page()).toContain(m['detail.noTotal']);
});

it('offers Accept when the gates are passed and takes the task once', async () => {
  await qualify();
  await mount();

  const accept = named(m['detail.claim']);
  expect(accept).toBeDefined();
  await act(async () => accept!.click());
  await act(async () => { await Promise.resolve(); });

  expect((await api.myClaims()).map((row) => row.taskId)).toEqual(['task-cook']);
});

it('replaces Accept with the reason it cannot be pressed', async () => {
  // Registered, but no exam pass: APP-05's gate, and the server enforces it
  // too. The control is not merely disabled — it is not there.
  await api.register('Nguyễn Thị Mai', '0901234567');
  await mount();

  expect(named(m['detail.claim'])).toBeUndefined();
  expect(page()).toContain(m['detail.needExam']);
});

it('offers retry rather than an action when a read failed', async () => {
  await qualify();
  vi.spyOn(api, 'task').mockRejectedValue(new Error('offline'));
  await mount();

  expect(page()).toContain(m['common.loadFailed']);
  expect(named(m['common.retry'])).toBeDefined();
  // Unknown state must not offer the money action.
  expect(named(m['detail.claim'])).toBeUndefined();
});

it('says a full task is full', async () => {
  await qualify();
  // `task-office` is seeded at capacity: 2 claimants of 2, 0 places left.
  await mount('task-office');

  expect(named(m['detail.claim'])).toBeUndefined();
  expect(page()).toContain(m['detail.full']);
});
