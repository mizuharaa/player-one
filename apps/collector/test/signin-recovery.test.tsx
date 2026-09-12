// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api/context.tsx';
import { HttpCollectorApi } from '../src/api/http.ts';
import type { TokenStore } from '../src/api/token-store.ts';
import { MESSAGES } from '../src/i18n.ts';
import { LocaleProvider } from '../src/locale.tsx';
import { SignIn } from '../src/screens/SignIn.tsx';

// Native presentation only: exercise the real screen, query mutations and HTTP client.
// The screen is hand-rolled native now — `react-native` views, the theme and the
// mascot, not only `ui.tsx` primitives — so `react-native` itself has to resolve.
// Its published source is Flow, which vitest cannot parse; `react-native-web` is
// already a devDependency here and implements the same surface over the DOM.
vi.mock('react-native', async () => ({ ...await import('react-native-web') }));
vi.mock('../src/ui.tsx', async (original) => ({
  ...await original<Record<string, unknown>>(),
  Body: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Screen: ({ title, children }: { title: string; children: ReactNode }) => <main><h1>{title}</h1>{children}</main>,
  Note: ({ text }: { text: string }) => <p role="status">{text}</p>,
  Button: ({ label, disabled, onPress }: { label: string; disabled?: boolean; onPress: () => void }) =>
    <button disabled={disabled} onClick={onPress}>{label}</button>,
  Field: ({ label, value, onChangeText, editable = true }: { label: string; value: string; onChangeText: (text: string) => void; editable?: boolean }) =>
    <label>{label}<input aria-label={label} value={value} readOnly={!editable} onChange={(event) => onChangeText(event.target.value)} /></label>,
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let client: QueryClient;
let fetchFn: ReturnType<typeof vi.fn<typeof fetch>>;
let signedIn: ReturnType<typeof vi.fn>;
let tokens: TokenStore & { value: string | null };
const copy = MESSAGES.vi;
const resend = 'Gửi lại mã';
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

async function mount() {
  const api = new HttpCollectorApi('https://collector.test', tokens, () => {}, fetchFn);
  await act(async () => root.render(
    <QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider>
      <SignIn onSignedIn={signedIn} />
    </LocaleProvider></ApiProvider></QueryClientProvider>,
  ));
  await edit(copy['signIn.phone'], '0903000001');
}
function button(label: string) {
  const result = Array.from(container.querySelectorAll('button')).find((node) => node.textContent === label);
  expect(result, label).toBeDefined();
  return result!;
}
async function tap(label: string) { await act(async () => button(label).click()); }
async function edit(label: string, value: string) {
  await act(async () => changeField(label, value));
}
function changeField(label: string, value: string) {
  const field = container.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, value);
  field.dispatchEvent(new Event('input', { bubbles: true }));
}
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
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  fetchFn = vi.fn<typeof fetch>();
  signedIn = vi.fn();
  tokens = {
    value: null,
    async get() { return this.value; },
    async set(value) { this.value = value; },
    async clear() { this.value = null; },
  };
});
afterEach(async () => {
  await act(async () => root.unmount());
  client.clear();
  container.remove();
});

describe('APP-01 sign-in recovery', () => {
  it('shows a failed send truthfully and retries through the real HTTP client', async () => {
    fetchFn.mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    await mount();
    await tap(copy['signIn.sendCode']);
    await settle(() => expect(container.textContent).toContain(copy['common.actionFailed']));
    expect(container.textContent).not.toContain(copy['signIn.codeSent']);
    await tap(copy['signIn.sendCode']);
    await settle(() => expect(container.textContent).toContain(copy['signIn.codeSent']));
    expect(container.textContent).not.toContain(copy['common.actionFailed']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('can resend after expiry, blocks duplicate sends and verifies only after sending finishes', async () => {
    const pending = deferredResponse();
    fetchFn.mockResolvedValueOnce(json({ demo_code: '123456' }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockReturnValueOnce(pending.promise).mockResolvedValueOnce(json({ token: 'token' }));
    await mount();
    await tap(copy['signIn.sendCode']);
    await settle(() => expect(container.textContent).toContain(copy['signIn.demoFilled']));
    await tap(copy['signIn.submit']);
    await settle(() => expect(container.textContent).toContain(copy['signIn.badCode']));
    await act(async () => { button(resend).click(); button(resend).click(); });
    await settle(() => expect(button(resend).disabled).toBe(true));
    expect(button(copy['signIn.submit']).disabled).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    await act(async () => pending.resolve(json({ demo_code: '654321' })));
    await settle(() => expect(button(resend).disabled).toBe(false));
    expect(container.querySelector<HTMLInputElement>(`input[aria-label="${copy['signIn.code']}"]`)?.value).toBe('654321');
    expect(container.textContent).not.toContain(copy['signIn.badCode']);
    await tap(copy['signIn.submit']);
    await settle(() => expect(signedIn).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchFn.mock.calls[3]?.[1]?.body))).toEqual({ phone: '+84903000001', code: '654321' });
  });

  it('clears sent, code and demo state when the phone changes', async () => {
    fetchFn.mockResolvedValueOnce(json({ demo_code: '123456' }));
    await mount();
    await tap(copy['signIn.sendCode']);
    await settle(() => expect(container.textContent).toContain(copy['signIn.demoFilled']));
    await edit(copy['signIn.phone'], '0903000002');
    expect(container.textContent).not.toContain(copy['signIn.codeSent']);
    expect(container.textContent).not.toContain(copy['signIn.demoFilled']);
    expect(container.querySelector(`input[aria-label="${copy['signIn.code']}"]`)).toBeNull();
    expect(button(copy['signIn.sendCode']).disabled).toBe(false);
  });

  it.each([200, 500])('ignores late HTTP %s after changing the phone away and back', async (status) => {
    const pending = deferredResponse();
    fetchFn.mockReturnValueOnce(pending.promise);
    await mount();
    await tap(copy['signIn.sendCode']);
    await edit(copy['signIn.phone'], '0903000002');
    await edit(copy['signIn.phone'], '0903000001');
    await act(async () => pending.resolve(status === 200 ? json({ demo_code: '123456' }) : new Response(null, { status })));
    await settle(() => expect(button(copy['signIn.sendCode']).disabled).toBe(false));
    expect(container.textContent).not.toContain(copy['signIn.codeSent']);
    expect(container.textContent).not.toContain(copy['signIn.demoFilled']);
    expect(container.textContent).not.toContain(copy['common.actionFailed']);
  });

  it('does not navigate on a verification completed after unmount', async () => {
    const pending = deferredResponse();
    fetchFn.mockResolvedValueOnce(json({ demo_code: '123456' })).mockReturnValueOnce(pending.promise);
    await mount();
    await tap(copy['signIn.sendCode']);
    await settle(() => expect(container.textContent).toContain(copy['signIn.demoFilled']));
    await tap(copy['signIn.submit']);
    await act(async () => root.render(<p>Different screen</p>));
    await act(async () => pending.resolve(json({ token: 'token' })));
    await settle(() => expect(fetchFn).toHaveBeenCalledTimes(2));
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('locks the visible phone during verification, including edits before rerender, and stores that identity', async () => {
    const pending = deferredResponse();
    fetchFn.mockResolvedValueOnce(json({ demo_code: '123456' })).mockReturnValueOnce(pending.promise);
    await mount();
    await tap(copy['signIn.sendCode']);
    await settle(() => expect(container.textContent).toContain(copy['signIn.demoFilled']));
    await act(async () => {
      button(copy['signIn.submit']).click();
      changeField(copy['signIn.phone'], '0903000002');
    });
    const phone = container.querySelector<HTMLInputElement>(`input[aria-label="${copy['signIn.phone']}"]`)!;
    const visibleWhilePending = phone.value;
    const lockedWhilePending = phone.readOnly;
    await edit(copy['signIn.phone'], '0903000003');
    const visibleAfterSecondEdit = phone.value;
    expect(tokens.value).toBeNull();
    await act(async () => pending.resolve(json({ token: 'token-for-first-phone' })));
    await settle(() => expect(tokens.value).toBe('token-for-first-phone'));
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body))).toEqual({ phone: '+84903000001', code: '123456' });
    expect(visibleWhilePending).toBe('0903000001');
    expect(lockedWhilePending).toBe(true);
    expect(visibleAfterSecondEdit).toBe('0903000001');
    expect(phone.value).toBe('0903000001');
    expect(signedIn).toHaveBeenCalledTimes(1);
  });
});
