import { Agreements } from '../src/screens/Agreements.tsx';
import { HttpCollectorApi } from '../src/api/http.ts';
// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { AGREEMENTS, type CollectorApi } from '../src/api/types.ts';
import { HEADSET_COPY, HEADSET_GUIDANCE } from '../src/headset-guidance.ts';
import { MESSAGES } from '../src/i18n.ts';
import { LocaleProvider, useLocale } from '../src/locale.tsx';
import { NavProvider, useNav, type Route } from '../src/nav.tsx';
import { Training } from '../src/screens/Training.tsx';
import { SessionCreate } from '../src/screens/SessionCreate.tsx';
import { SessionReminder } from '../src/screens/SessionReminder.tsx';

// Only native presentation is replaced. Query mutations, API gates, locale and
// navigation run unchanged; the browser harness separately checks real controls.
vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  Switch: ({ value, onValueChange }: { value: boolean; onValueChange: (value: boolean) => void }) => <input type="checkbox" checked={value} onChange={event => onValueChange(event.target.checked)} />,
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Pressable: ({ children, onPress }: { children: ReactNode; onPress: () => void }) => <button onClick={onPress}>{children}</button>,
  // §7 puts a 16/9 header still above the guidance. It is presentation and
  // this file is about the flow, so it renders as nothing with its name kept.
  Image: ({ accessibilityLabel }: { accessibilityLabel?: string }) => <img alt={accessibilityLabel ?? ''} />,
  BackHandler: { addEventListener: () => ({ remove() {} }) },
}));
// `SessionCreate` now reads two facts off the phone (APP-19). Both arrive
// through native modules that want the React Native runtime at module load,
// and both are above their thresholds here: this file is about the flow, and
// the readings have their own file (`prechecks.test.tsx`).
vi.mock('expo-battery', () => ({ getBatteryLevelAsync: async () => 0.9, isLowPowerModeEnabledAsync: async () => false }));
vi.mock('../src/upload/delivery-native.ts', () => ({ freeDiskBytes: () => 8 * 1024 ** 3 }));
vi.mock('../src/ui.tsx', () => ({
  face: () => 'System',
  Body: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  // `footer` is §7's pinned commit control; without it here the training
  // screen has no button to press.
  Screen: ({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) =>
    <main><h1>{title}</h1>{children}<footer>{footer}</footer></main>,
  Note: ({ text }: { text: string }) => <p role="status">{text}</p>,
  Loading: () => <p role="status">loading</p>,
  Row: ({ label, value }: { label: string; value: string }) => <p>{label}: {value}</p>,
  Button: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) =>
    <button disabled={disabled} onClick={onPress}>{label}</button>,
  Choice: ({ label, disabled, selected, onPress }: { label: string; disabled?: boolean; selected: boolean; onPress: () => void }) =>
    <button disabled={disabled} aria-pressed={selected} onClick={onPress}>{label}</button>,
}));

declare global {
  // React's opt-in for deterministic act() warnings in a test environment.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let api: MockCollectorApi;

function Flow() {
  const nav = useNav();
  const { setLocale } = useLocale();
  return <>
    <button onClick={() => nav.back()}>Back in test</button>
    <button onClick={() => nav.push({ name: 'training' })}>Training in test</button>
    <button onClick={() => setLocale('en')}>English in test</button>
    {nav.route.name === 'agreements' ? <Agreements /> : nav.route.name === 'training' ? <Training /> : nav.route.name === 'sessionCreate' ? <SessionCreate /> :
      nav.route.name === 'sessionReminder' ? <SessionReminder /> :
      <><h1>{nav.route.name}</h1><button onClick={() => nav.push({ name: 'sessionReminder' })}>Prepare in test</button></>}
  </>;
}

async function mount(route: Route, value: CollectorApi = api) {
  await act(async () => root.render(
    <QueryClientProvider client={client}><ApiProvider value={value}><LocaleProvider initialLocale="vi">
      <NavProvider initial={route}><Flow /></NavProvider>
    </LocaleProvider></ApiProvider></QueryClientProvider>,
  ));
}
function button(label: string) {
  const found = Array.from(container.querySelectorAll('button')).find((element) => element.textContent === label);
  expect(found, label).toBeDefined();
  return found!;
}
async function tap(label: string) {
  await act(async () => button(label).click());
}
async function settle(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    check();
  });
}

beforeEach(async () => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  api = new MockCollectorApi();
  await api.register('Nguyễn Văn A', '0903000001');
  await api.acceptAgreements(AGREEMENTS.map(({ id, version }) => ({ agreementId: id, version })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
  vi.restoreAllMocks();
});

describe('guidance in the collector flow', () => {
  it('renders the supplied guidance in both app locales before completion', async () => {
    const complete = vi.spyOn(api, 'completeTraining');
    await mount({ name: 'training' });
    for (const locale of ['vi', 'en'] as const) {
      if (locale === 'en') await tap('English in test');
      for (const section of HEADSET_GUIDANCE) {
        expect(container.textContent).toContain(section.title[locale]);
        for (const item of section.items) expect(container.textContent).toContain(item.text[locale]);
      }
      expect(container.textContent).toContain(HEADSET_COPY.external[locale]);
    }
    expect(complete).not.toHaveBeenCalled();
    expect((await api.profile())?.trainingDone).toBe(false);
  });

  it('can leave the training placeholder for the exam without completing training', async () => {
    const complete = vi.spyOn(api, 'completeTraining');
    await mount({ name: 'home' });
    await tap('Training in test');
    expect(container.textContent).toContain(MESSAGES.vi['training.placeholder']);
    expect(container.textContent).not.toContain(MESSAGES.vi['training.done']);
    expect(container.querySelector('footer')?.textContent).toBe('');
    await settle(() => expect(button(MESSAGES.vi['exam.title'])).toBeDefined());
    await tap(MESSAGES.vi['exam.title']);
    expect(container.querySelector('h1')?.textContent).toBe('exam');
    expect(complete).not.toHaveBeenCalled();
    expect((await api.profile())?.trainingDone).toBe(false);
  });

  it('shows the reminder on every new session visit, supports Back and adds no declaration', async () => {
    const create = vi.spyOn(api, 'createSession');
    const complete = vi.spyOn(api, 'completeTraining');
    await mount({ name: 'home' });
    const begin = vi.spyOn(api, 'beginSessionAttempt');
    await tap('Prepare in test');
    expect(container.querySelector('h1')?.textContent).toBe(HEADSET_COPY.shiftTitle.vi);
    expect(container.textContent).toContain(HEADSET_COPY.shiftIntro.vi);
    expect(container.querySelectorAll('[aria-pressed]')).toHaveLength(0);
    expect(begin).not.toHaveBeenCalled();
    await tap('Back in test');
    expect(container.querySelector('h1')?.textContent).toBe('home');
    await tap('Prepare in test');
    await tap(HEADSET_COPY.continue.vi);
    await settle(() => expect(container.textContent).toContain(MESSAGES.vi['session.needClaim']));
    expect(begin).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(MESSAGES.vi['session.othersTitle']);
    expect(container.textContent).not.toContain(MESSAGES.vi['session.sensitiveTitle']);
    expect(create).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    await tap('Back in test');
    expect(container.querySelector('h1')?.textContent).toBe(HEADSET_COPY.shiftTitle.vi);
    await tap('Back in test');
    await tap('Prepare in test');
    expect(container.querySelector('h1')?.textContent).toBe(HEADSET_COPY.shiftTitle.vi);
  });

  it('asks each preparation question in order and sends neither declaration until both are answered', async () => {
    await api.completeTraining();
    await api.submitExam([true, true, true]);
    const task = (await api.tasks()).find(t => t.claimable)!;
    await api.claimTask(task.id);
    await api.bindDevice('EGO-TEST');
    const create = vi.spyOn(api, 'createSession');
    await mount({ name: 'sessionCreate' });
    await settle(() => expect(button(MESSAGES.vi['common.next']).disabled).toBe(true));
    await tap(task.title);
    await tap(MESSAGES.vi['common.next']);
    await tap(MESSAGES.vi['scenario.home']);
    await tap(MESSAGES.vi['common.next']);
    await tap('EGO-TEST');
    await tap(MESSAGES.vi['common.next']);
    expect(container.textContent).toContain(MESSAGES.vi['session.othersTitle']);
    expect(container.textContent).not.toContain(MESSAGES.vi['session.sensitiveTitle']);
    expect(button(MESSAGES.vi['common.next']).disabled).toBe(true);
    await tap(MESSAGES.vi['session.no']);
    await tap(MESSAGES.vi['common.next']);
    expect(button(MESSAGES.vi['session.create']).disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
    await tap(MESSAGES.vi['session.yes']);
    await tap(MESSAGES.vi['session.create']);
    await settle(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create).toHaveBeenCalledWith({ taskId: task.id, deviceSerial: 'EGO-TEST', scenario: 'home', othersInFrame: false, sensitiveInfo: true });
    await settle(() => expect(button(MESSAGES.vi['uploads.deliverTitle'])).toBeDefined());
  });
});

vi.mock('../src/ui/illustrations/index.tsx', () => ({ HowCharge: () => null, HowWear: () => null, HowPressDevice: () => null, HowHandOver: () => null }));

// Native illustration rendering is covered by the web captures.
vi.mock('../src/ui/illustrations/index.tsx', () => ({ EmptyTasks: () => null, ErrorMark: () => null, HowCharge: () => null, HowWear: () => null, HowPressDevice: () => null, HowHandOver: () => null }));


it('walks the six Agreements into the exam route', async () => {
  api = new MockCollectorApi(); await api.register('Collector', '0903000001');
  const complete = vi.spyOn(api, 'completeTraining');
  await mount({ name: 'agreements' });
  for (const input of container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')) await act(async () => input.click());
  await tap(MESSAGES.vi['agreements.submit']);
  await settle(() => expect(container.querySelector('h1')?.textContent).toBe('exam'));
  expect((await api.profile())?.agreements).toHaveLength(AGREEMENTS.length);
  expect(complete).not.toHaveBeenCalled();
});

it('never posts training completion when continuing from the placeholder', async () => {
  const fetchFn = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ id: 'collector', name: 'Collector', phone: '0903000001', agreements: [], training_done: false, exam_passed: false, onboarded: true })));
  const http = new HttpCollectorApi('https://collector.test', { get: async () => 'collector-token', set: async () => {}, clear: async () => {} }, () => {}, fetchFn);
  await http.restoreSession();
  await mount({ name: 'training' }, http);
  await settle(() => expect(button(MESSAGES.vi['exam.title'])).toBeDefined());
  await tap(MESSAGES.vi['exam.title']);
  expect(container.querySelector('h1')?.textContent).toBe('exam');
  expect(fetchFn).toHaveBeenCalled();
  expect(fetchFn.mock.calls.every(([url, init]) => String(url).endsWith('/api/me/profile') && init?.method === 'GET')).toBe(true);
});


it('keeps Back on the training placeholder when the exam is already passed', async () => {
  await api.submitExam([true, true, true]);
  await mount({ name: 'home' }); await tap('Training in test');
  await settle(() => expect(button(MESSAGES.vi['common.back'])).toBeDefined());
  expect(Array.from(container.querySelectorAll('button')).some(node => node.textContent === MESSAGES.vi['exam.title'])).toBe(false);
  await tap(MESSAGES.vi['common.back']);
  expect(container.querySelector('h1')?.textContent).toBe('home');
});
