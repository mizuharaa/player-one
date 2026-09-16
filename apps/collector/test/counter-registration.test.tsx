// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LocaleProvider } from '../src/locale.tsx';
import { LOCALES, MESSAGES } from '../src/i18n.ts';
import { Landing } from '../src/screens/Landing.tsx';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-native', async () => import('react-native-web'));
vi.mock('../src/zalo.tsx', () => ({ useZaloSignIn: () => ({}), ZaloSignIn: () => null }));
vi.mock('../src/shell/BrandSlot.tsx', () => ({ BrandSlot: () => null }));
vi.mock('../src/ui/illustrations/index.tsx', () => ({ HowHandOver: () => <svg aria-label="handover" /> }));
vi.mock('../src/ui.tsx', () => ({
  Screen: ({ title, children, onBack }: { title: string; children: ReactNode; onBack: () => void }) => <main><h1>{title}</h1><button onClick={onBack}>Back</button>{children}</main>,
  Body: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  Title: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Button: ({ label, onPress }: { label: string; onPress: () => void }) => <button onClick={onPress}>{label}</button>,
  Film: () => null, LegalLine: () => null, Scrim: () => null,
  face: () => 'sans-serif', useInsets: () => ({ top: 0, bottom: 0 }), useReducedMotion: () => true,
}));

it.each(LOCALES)('counter registration opens complete guidance and returns without registering (%s)', async locale => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const signIn = vi.fn();
  const signedIn = vi.fn();
  const request = vi.fn();
  vi.stubGlobal('fetch', request);
  try {
    await act(async () => root.render(<LocaleProvider initialLocale={locale}><Landing onSignIn={signIn} onSignedIn={signedIn} /></LocaleProvider>));
    const register = Array.from(host.querySelectorAll('button')).find(button => button.textContent === MESSAGES[locale]['landing.register'])!;
    await act(async () => register.click());
    expect(document.body.querySelector('main')).not.toBeNull();
    expect(document.body.querySelector('main svg')).not.toBeNull();
    for (const key of ['counter.bring', 'counter.where', 'counter.staff', 'counter.next'] as const) {
      expect(document.body.querySelector('main')?.textContent).toContain(MESSAGES[locale][key]);
    }
    await act(async () => document.body.querySelector('main button')!.click());
    expect(document.body.querySelector('main')).toBeNull();
    expect(signIn).not.toHaveBeenCalled();
    expect(signedIn).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  } finally { await act(async () => root.unmount()); vi.unstubAllGlobals(); host.remove(); }
});
