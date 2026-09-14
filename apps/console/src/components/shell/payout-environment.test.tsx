// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { MESSAGES } from '@playerone/api/i18n';
import { PayoutEnvironment } from './PayoutEnvironment.tsx';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => MESSAGES.en[key as keyof typeof MESSAGES.en] ?? key }) }));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
it('the console header visibly labels the API sandbox as simulation', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ environment: 'sandbox' }) }));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = document.createElement('div');
  const root = createRoot(node);
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><PayoutEnvironment /></QueryClientProvider>));
    await vi.waitFor(async () => {
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      expect(node.querySelector('header')?.textContent).toContain('ZaloPay sandbox');
      expect(node.textContent).toContain('Simulation');
    });
  } finally { await act(async () => root.unmount()); client.clear(); vi.unstubAllGlobals(); }
});
