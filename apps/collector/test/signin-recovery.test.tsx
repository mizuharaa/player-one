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
/**
 * `expo-video` reaches `expo-modules-core`, which asks the native runtime for
 * its `EventEmitter` at module load and throws in node. Same reason
 * `expo-secure-store` and `expo-file-system` are mocked in these files: this
 * suite is about behaviour, not about a decoder. `ui.tsx` imports it for
 * `Film`, and every file that reaches `ui.tsx` therefore reaches this.
 */
vi.mock('expo-video', () => ({ VideoView: () => null, useVideoPlayer: () => ({ addListener: () => ({ remove: () => {} }), status: 'idle' }) }));
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
  // SPEC.md §4's six boxes. One hidden input owns the value on the real thing
  // too, so the seam this test drives is the same one: `onChangeText` with the
  // whole code, and auto-submit when it reaches six digits.
  CodeBoxes: ({ label, value, onChangeText, editable = true }: { label: string; value: string; onChangeText: (text: string) => void; editable?: boolean }) =>
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
/**
 * The resend control's label is not constant any more: §4 counts down from
 * arrival and the label is `signIn.resendIn` while it does. Both strings start
 * "Gửi lại", so the control is found by its stem and its label is asserted
 * separately where the countdown is the subject.
 */
const resendStem = 'Gửi lại';
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

async function mount() {
  const api = new HttpCollectorApi('https://collector.test', tokens, () => {}, fetchFn);
  await act(async () => root.render(
    <QueryClientProvider client={client}><ApiProvider value={api}><LocaleProvider initialLocale="vi">
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
function resendButton() {
  const result = Array.from(container.querySelectorAll('button')).find((node) => node.textContent?.startsWith(resendStem));
  expect(result, resendStem).toBeDefined();
  return result!;
}
/**
 * Whether the screen has advanced to §4. It used to be enough to look for
 * `signIn.codeSent`, but §3 now pre-announces that sentence above the send
 * button rather than revealing it after — so the presence of the code row is
 * what says a code was actually accepted for sending.
 */
function codeRow() {
  return container.querySelector<HTMLInputElement>(`input[aria-label="${copy['signIn.code']}"]`);
}
async function tap(label: string) { await act(async () => button(label).click()); }
/**
 * §4's back control, which is the only way from the code step to the number
 * step now that they are two steps. It is a `Pressable` rather than `Button`,
 * so react-native-web renders it as a role=button element and not a `<button>`.
 */
async function tapBack() {
  const node = container.querySelector<HTMLElement>(`[aria-label="${copy['common.back']}"]`);
  expect(node, 'back control').not.toBeNull();
  await act(async () => node!.click());
}
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
    // A failed send must not advance to the code step. It used to be asserted
    // as the absence of `signIn.codeSent`; that sentence is now on §3 before
    // the press by design, so the step itself is what is asserted.
    expect(codeRow()).toBeNull();
    await tap(copy['signIn.sendCode']);
    await settle(() => expect(codeRow()).not.toBeNull());
    expect(container.textContent).not.toContain(copy['common.actionFailed']);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  /**
   * §4's resend rule, which is an accessibility rule and not a styling one: a
   * control that looks disabled and announces itself as enabled is worse than
   * one that is plainly gone. TalkBack reads it as actionable, the collector
   * double-taps, and nothing happens. `Button` carries `disabled` into both
   * the pressable and `accessibilityState`, and the label says how long.
   */
  it('locks resend behind its countdown as soon as a code is on its way', async () => {
    fetchFn.mockResolvedValueOnce(json({ demo_code: '123456' }));
    await mount();
    await tap(copy['signIn.sendCode']);
    await settle(() => expect(codeRow()).not.toBeNull());
    expect(resendButton().disabled).toBe(true);
    expect(resendButton().textContent).toBe(copy['signIn.resendIn'].replace('{s}', '60'));
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  /**
   * Blocks duplicate sends and verifies only after sending finishes.
   *
   * This used to drive the duplicate through §4's resend control; §4 now locks
   * that behind a sixty-second countdown, which is a stronger guarantee than
   * the one the test was making and is the test above. The guard itself —
   * `submitting.current`, synchronous, so it also catches a second tap that
   * arrives before React rerenders the disabled button — lives on the send
   * path, so that is where it is exercised now.
   */
  it('blocks a duplicate send and verifies only after sending finishes', async () => {
    const pending = deferredResponse();
    fetchFn.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(json({ token: 'token' }));
    await mount();
    await act(async () => {
      button(copy['signIn.sendCode']).click();
      button(copy['signIn.sendCode']).click();
    });
    expect(button(copy['signIn.sendCode']).disabled).toBe(true);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(json({ demo_code: '654321' })));
    await settle(() => expect(container.textContent).toContain(copy['signIn.demoFilled']));
    expect(codeRow()?.value).toBe('654321');
    expect(container.textContent).not.toContain(copy['signIn.badCode']);
    await tap(copy['signIn.submit']);
    await settle(() => expect(signedIn).toHaveBeenCalledTimes(1));
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body))).toEqual({ phone: '+84903000001', code: '654321' });
  });

  /** One 401 covers a wrong code, an expired one and too many guesses. */
  it('renders the one refusal the server gives for a bad code, and keeps the step', async () => {
    fetchFn.mockResolvedValueOnce(json({ demo_code: '123456' }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    await mount();
    await tap(copy['signIn.sendCode']);
    await settle(() => expect(container.textContent).toContain(copy['signIn.demoFilled']));
    await tap(copy['signIn.submit']);
    await settle(() => expect(container.textContent).toContain(copy['signIn.badCode']));
    expect(codeRow()).not.toBeNull();
    expect(signedIn).not.toHaveBeenCalled();
  });

  it('clears sent, code and demo state when the phone changes', async () => {
    fetchFn.mockResolvedValueOnce(json({ demo_code: '123456' }));
    await mount();
    await tap(copy['signIn.sendCode']);
    await settle(() => expect(container.textContent).toContain(copy['signIn.demoFilled']));
    // §3 and §4 are two steps now, so reaching the number again goes through
    // the back control. It runs the same clear the field's own edit ran.
    await tapBack();
    await edit(copy['signIn.phone'], '0903000002');
    expect(codeRow()).toBeNull();
    expect(container.textContent).not.toContain(copy['signIn.demoFilled']);
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
    expect(codeRow()).toBeNull();
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

  /**
   * The identity being verified is locked, and the token that comes back
   * belongs to it.
   *
   * This used to be proved by editing the number field mid-verification and
   * checking the edit was refused. §3 and §4 are two steps now, so that field
   * is not on screen during verification at all — the race is gone by
   * construction rather than guarded against, which is why the assertion is
   * that it is unreachable. The guard in `editPhone` is still there and is
   * still the thing that would catch an edit arriving from anywhere else.
   */
  it('locks the number it is verifying and stores the token against that identity', async () => {
    const pending = deferredResponse();
    fetchFn.mockResolvedValueOnce(json({ demo_code: '123456' })).mockReturnValueOnce(pending.promise);
    await mount();
    await tap(copy['signIn.sendCode']);
    await settle(() => expect(container.textContent).toContain(copy['signIn.demoFilled']));
    await tap(copy['signIn.submit']);
    expect(container.querySelector(`input[aria-label="${copy['signIn.phone']}"]`)).toBeNull();
    expect(codeRow()?.readOnly).toBe(true);
    expect(tokens.value).toBeNull();
    await act(async () => pending.resolve(json({ token: 'token-for-first-phone' })));
    await settle(() => expect(tokens.value).toBe('token-for-first-phone'));
    expect(JSON.parse(String(fetchFn.mock.calls[1]?.[1]?.body))).toEqual({ phone: '+84903000001', code: '123456' });
    expect(signedIn).toHaveBeenCalledTimes(1);
  });
});

// Native inset measurements are supplied by the device, not jsdom.
vi.mock('react-native-safe-area-context', async () => ({
  initialWindowMetrics: null, SafeAreaInsetsContext: (await import('react')).createContext(null),
}));

vi.mock('../src/ui/HeaderGradient.tsx', () => ({ HeaderGradient: ({ children }: { children: import('react').ReactNode }) => children }));

vi.mock('expo-battery', () => ({ isLowPowerModeEnabledAsync: async () => false, addLowPowerModeListener: () => ({ remove() {} }) }));

// Native illustration rendering is covered by the web captures.
vi.mock('../src/ui/illustrations/index.tsx', () => ({ EmptyTasks: () => null, ErrorMark: () => null }));

it('shows the unreachable state before authentication and opens the shared Server setting', async () => {
  fetchFn.mockRejectedValueOnce(new TypeError('offline'));
  await mount();
  await tap(copy['signIn.sendCode']);
  await settle(() => expect(container.textContent).toContain(copy['state.offline']));
  expect(codeRow()).toBeNull();
  await tap(copy['server.title']);
  await settle(() => expect(document.body.textContent).toContain(copy['server.address']));
  expect(document.body.textContent).toContain(copy['profile.about']);
  expect(tokens.value).toBeNull();
});

it('plain Retry repeats an offline sign-in request without opening Server settings', async () => {
  fetchFn.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValueOnce(json({ demo_code: '123456' }));
  await mount();
  await tap(copy['signIn.sendCode']);
  await settle(() => expect(container.textContent).toContain(copy['state.offline']));
  await tap(copy['common.retry']);
  await settle(() => expect(container.textContent).toContain(copy['signIn.demoFilled']));
  expect(fetchFn).toHaveBeenCalledTimes(2);
  expect(document.body.textContent).not.toContain(copy['server.address']);
});

it('retries an offline new request after an earlier verification refusal', async () => {
  fetchFn.mockResolvedValueOnce(json({ demo_code: '123456' }))
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockRejectedValueOnce(new TypeError('offline'))
    .mockResolvedValueOnce(json({ demo_code: '654321' }));
  await mount(); await tap(copy['signIn.sendCode']);
  await settle(() => expect(codeRow()).not.toBeNull());
  await tap(copy['signIn.submit']);
  await settle(() => expect(container.textContent).toContain(copy['signIn.badCode']));
  await tapBack(); await tap(copy['signIn.sendCode']);
  await settle(() => expect(container.textContent).toContain(copy['state.offline']));
  await tap(copy['common.retry']);
  expect(fetchFn).toHaveBeenCalledTimes(4);
});
