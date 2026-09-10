// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { MockCollectorApi } from '../src/api/mock.ts';
import { AGREEMENTS } from '../src/api/types.ts';
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
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BackHandler: { addEventListener: () => ({ remove() {} }) },
}));
vi.mock('../src/ui.tsx', () => ({
  Body: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Screen: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
  Note: ({ text }: { text: string }) => <p role="status">{text}</p>,
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
    {nav.route.name === 'training' ? <Training /> : nav.route.name === 'sessionCreate' ? <SessionCreate /> :
      nav.route.name === 'sessionReminder' ? <SessionReminder /> :
      <><h1>{nav.route.name}</h1><button onClick={() => nav.push({ name: 'sessionReminder' })}>Prepare in test</button></>}
  </>;
}

async function mount(route: Route) {
  await act(async () => root.render(
    <QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider>
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

  it('waits for training to save, disables repeat submission and only then opens the exam', async () => {
    const original = api.completeTraining.bind(api);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const complete = vi.spyOn(api, 'completeTraining').mockImplementation(async () => { await pending; return original(); });
    await mount({ name: 'training' });
    await tap(MESSAGES.vi['training.done']);
    await settle(() => expect(button(MESSAGES.vi['common.loading']).disabled).toBe(true));
    await tap(MESSAGES.vi['common.loading']);
    expect(complete).toHaveBeenCalledTimes(1);
    expect(container.querySelector('h1')?.textContent).toBe(MESSAGES.vi['training.title']);
    await act(async () => release());
    await settle(() => expect(container.querySelector('h1')?.textContent).toBe('exam'));
    expect((await api.profile())?.trainingDone).toBe(true);
  });

  it('retains guidance after a failed completion and lets the collector retry', async () => {
    const complete = vi.spyOn(api, 'completeTraining').mockRejectedValueOnce(new Error('offline'));
    await mount({ name: 'training' });
    await tap(MESSAGES.vi['training.done']);
    await settle(() => expect(container.textContent).toContain(MESSAGES.vi['common.actionFailed']));
    expect(container.querySelector('h1')?.textContent).toBe(MESSAGES.vi['training.title']);
    expect((await api.profile())?.trainingDone).toBe(false);
    expect(button(MESSAGES.vi['training.done']).disabled).toBe(false);
    await tap(MESSAGES.vi['training.done']);
    await settle(() => expect(container.querySelector('h1')?.textContent).toBe('exam'));
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it('does not navigate into the exam when training completes after leaving the screen', async () => {
    const original = api.completeTraining.bind(api);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    vi.spyOn(api, 'completeTraining').mockImplementation(async () => { await pending; return original(); });
    await mount({ name: 'home' });
    await tap('Training in test');
    await tap(MESSAGES.vi['training.done']);
    await tap('Back in test');
    await act(async () => finish());
    await settle(() => expect(container.querySelector('h1')?.textContent).toBe('home'));
    expect((await api.profile())?.trainingDone).toBe(true);
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
    await settle(() => expect(container.textContent).toContain(MESSAGES.vi['session.needDeclarations']));
    expect(begin).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain(MESSAGES.vi['session.othersTitle']);
    expect(container.textContent).toContain(MESSAGES.vi['session.sensitiveTitle']);
    expect(create).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    await tap('Back in test');
    expect(container.querySelector('h1')?.textContent).toBe(HEADSET_COPY.shiftTitle.vi);
    await tap('Back in test');
    await tap('Prepare in test');
    expect(container.querySelector('h1')?.textContent).toBe(HEADSET_COPY.shiftTitle.vi);
  });
});
