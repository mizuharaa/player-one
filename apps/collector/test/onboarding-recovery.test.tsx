// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { HttpCollectorApi } from '../src/api/http.ts';
import { AGREEMENTS } from '../src/api/types.ts';
import { LOCALES, MESSAGES, type Locale } from '../src/i18n.ts';
import { LocaleProvider, useLocale } from '../src/locale.tsx';
import { Agreements } from '../src/screens/Agreements.tsx';
import { Exam } from '../src/screens/Exam.tsx';

// Capture native callbacks so two calls in the same turn exercise the screen's
// guard, rather than being stopped by a mocked DOM button's disabled attribute.
const native = vi.hoisted(() => ({
  presses: new Map<string, () => void>(),
  changes: new Map<string, (value: boolean) => void>(),
  push: vi.fn(),
  reset: vi.fn(),
}));
vi.mock('react-native', () => ({
  View: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Switch: ({ accessibilityLabel, value, disabled, onValueChange }: {
    accessibilityLabel: string; value: boolean; disabled?: boolean; onValueChange: (value: boolean) => void;
  }) => {
    native.changes.set(accessibilityLabel, onValueChange);
    return <input type="checkbox" aria-label={accessibilityLabel} checked={value} disabled={disabled}
      onChange={(event) => onValueChange(event.target.checked)} />;
  },
}));
vi.mock('../src/nav.tsx', () => ({ useNav: () => ({ push: native.push, reset: native.reset }) }));
vi.mock('../src/ui.tsx', () => ({
  Body: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Screen: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
  Note: ({ text }: { text: string }) => <p role="status">{text}</p>,
  Tag: ({ label }: { label: string }) => <p>{label}</p>,
  Button: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) => {
    native.presses.set(label, onPress);
    return <button disabled={disabled} onClick={onPress}>{label}</button>;
  },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let fetchFn: ReturnType<typeof vi.fn<typeof fetch>>;
let selectLocale: (locale: Locale) => void;
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });
function LocaleControl() {
  selectLocale = useLocale().setLocale;
  return null;
}
async function mount(screen: 'agreements' | 'exam', locale: Locale = 'vi') {
  const api = new HttpCollectorApi('https://collector.test', {
    get: async () => 'collector-token', set: async () => {}, clear: async () => {},
  }, () => {}, fetchFn);
  await act(async () => root.render(
    <QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider>
      <LocaleControl />{screen === 'agreements' ? <Agreements /> : <Exam />}
    </LocaleProvider></ApiProvider></QueryClientProvider>,
  ));
  await act(async () => selectLocale(locale));
}
async function change(label: string, value: boolean) {
  await act(async () => native.changes.get(label)!(value));
}
async function press(label: string) { await act(async () => native.presses.get(label)!()); }
function switches() { return Array.from(container.querySelectorAll<HTMLInputElement>('input[type=checkbox]')); }
function body(index = 0) { return JSON.parse(String(fetchFn.mock.calls[index]?.[1]?.body)); }
async function settle(check: () => void) {
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
    check();
  });
}
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => { resolve = done; });
  return { promise, resolve };
}
async function checkAgreements(locale: Locale = 'vi') {
  for (const agreement of AGREEMENTS) await change(MESSAGES[locale][`agreement.${agreement.id}`], true);
}
beforeEach(() => {
  native.presses.clear(); native.changes.clear(); native.push.mockReset(); native.reset.mockReset();
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  fetchFn = vi.fn<typeof fetch>();
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear(); container.remove();
});

describe('APP-02 agreement recovery', () => {
  it('does not submit incomplete choices even if the native handler is invoked', async () => {
    await mount('agreements');
    await press(MESSAGES.vi['agreements.submit']);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(native.push).not.toHaveBeenCalled();
  });

  it.each(LOCALES)('retains choices on failure, retries exact versions and navigates only on success (%s)', async (locale) => {
    const copy = MESSAGES[locale];
    const pending = deferredResponse();
    fetchFn.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(json({ id: 'collector' }));
    await mount('agreements', locale);
    await checkAgreements(locale);
    const submit = native.presses.get(copy['agreements.submit'])!;
    const uncheck = native.changes.get(copy['agreement.user'])!;
    await act(async () => { submit(); submit(); uncheck(false); });
    await settle(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    expect(switches().every((input) => input.checked && input.disabled)).toBe(true);
    expect(native.push).not.toHaveBeenCalled();
    await act(async () => pending.resolve(new Response(null, { status: 500 })));
    await settle(() => expect(container.textContent).toContain(copy['common.actionFailed']));
    expect(switches().every((input) => input.checked && !input.disabled)).toBe(true);
    expect(native.push).not.toHaveBeenCalled();
    await press(copy['common.retry']);
    await settle(() => expect(native.push).toHaveBeenCalledTimes(1));
    expect(native.push).toHaveBeenCalledWith({ name: 'training' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(String(fetchFn.mock.calls[0]?.[0])).toBe('https://collector.test/api/me/agreements');
    expect(body()).toEqual({ agreements: AGREEMENTS.map((a) => ({ agreement: a.id, version: a.version })) });
    expect(body(1)).toEqual(body());
    expect(container.textContent).not.toContain(copy['common.actionFailed']);
  });

  it('does not navigate after leaving a pending agreement screen', async () => {
    const pending = deferredResponse();
    fetchFn.mockReturnValueOnce(pending.promise);
    await mount('agreements'); await checkAgreements();
    await press(MESSAGES.vi['agreements.submit']);
    await settle(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => root.render(<p>Another screen</p>));
    await act(async () => pending.resolve(json({ id: 'collector' })));
    await settle(() => expect(client.isMutating()).toBe(0));
    expect(native.push).not.toHaveBeenCalled();
  });
});

describe('APP-04 exam recovery', () => {
  it.each(LOCALES)('locks one answer snapshot, preserves it after a network failure and retries (%s)', async (locale) => {
    const copy = MESSAGES[locale];
    const pending = deferredResponse();
    fetchFn.mockReturnValueOnce(pending.promise).mockRejectedValueOnce(new TypeError('offline'))
      .mockResolvedValueOnce(json({ passed: true }));
    await mount('exam', locale);
    await change(copy['exam.q1'], true); await change(copy['exam.q3'], true);
    const submit = native.presses.get(copy['exam.submit'])!;
    const edit = native.changes.get(copy['exam.q1'])!;
    await act(async () => { submit(); submit(); edit(false); });
    await settle(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    expect(body()).toEqual({ answers: [true, false, true] });
    expect(switches().map((input) => input.checked)).toEqual([true, false, true]);
    expect(switches().every((input) => input.disabled)).toBe(true);
    await act(async () => pending.resolve(json({ passed: false })));
    await settle(() => expect(container.textContent).toContain(copy['exam.failed']));
    await press(copy['exam.submit']);
    await settle(() => expect(container.textContent).toContain(copy['common.actionFailed']));
    expect(container.textContent).not.toContain(copy['exam.failed']);
    expect(container.textContent).not.toContain(copy['exam.passed']);
    expect(switches().map((input) => input.checked)).toEqual([true, false, true]);
    expect(switches().every((input) => !input.disabled)).toBe(true);
    expect(native.reset).not.toHaveBeenCalled();
    await press(copy['common.retry']);
    await settle(() => expect(container.textContent).toContain(copy['exam.passed']));
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(body(1)).toEqual(body()); expect(body(2)).toEqual(body());
    expect(container.textContent).not.toContain(copy['common.actionFailed']);
    expect(native.reset).not.toHaveBeenCalled();
    await press(copy['home.tasks']);
    expect(native.reset).toHaveBeenCalledTimes(1);
    expect(native.reset).toHaveBeenCalledWith({ name: 'home' });
  });

  it('clears a failed result while the new submission is pending and when an answer changes', async () => {
    const copy = MESSAGES.vi;
    const pending = deferredResponse();
    fetchFn.mockResolvedValueOnce(json({ passed: false })).mockReturnValueOnce(pending.promise);
    await mount('exam');
    await press(copy['exam.submit']);
    await settle(() => expect(container.textContent).toContain(copy['exam.failed']));
    await press(copy['exam.submit']);
    await settle(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    expect(container.textContent).not.toContain(copy['exam.failed']);
    await act(async () => pending.resolve(json({ passed: false })));
    await settle(() => expect(container.textContent).toContain(copy['exam.failed']));
    await change(copy['exam.q2'], true);
    expect(container.textContent).not.toContain(copy['exam.failed']);
    expect(switches()[1]?.checked).toBe(true);
    expect(native.reset).not.toHaveBeenCalled();
  });

  it('preserves a successful pass and Tasks handoff despite late edit or submit callbacks', async () => {
    const copy = MESSAGES.vi;
    const pending = deferredResponse();
    fetchFn.mockReturnValueOnce(pending.promise);
    await mount('exam');
    for (const key of ['exam.q1', 'exam.q2', 'exam.q3'] as const) await change(copy[key], true);
    const staleSubmit = native.presses.get(copy['exam.submit'])!;
    const staleEdit = native.changes.get(copy['exam.q2'])!;
    await press(copy['exam.submit']);
    await settle(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => pending.resolve(json({ passed: true })));
    await settle(() => expect(container.textContent).toContain(copy['exam.passed']));
    await act(async () => { staleEdit(false); staleSubmit(); });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(switches().every((input) => input.checked && input.disabled)).toBe(true);
    expect(container.textContent).toContain(copy['exam.passed']);
    const tasks = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === copy['home.tasks']);
    expect(tasks?.disabled).toBe(false);
    await press(copy['home.tasks']);
    expect(native.reset).toHaveBeenCalledTimes(1);
    expect(native.reset).toHaveBeenCalledWith({ name: 'home' });
  });
});
