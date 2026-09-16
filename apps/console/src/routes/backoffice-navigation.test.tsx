// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createMemoryHistory, createRootRoute, createRoute, createRouter, Outlet, RouterProvider } from '@tanstack/react-router';
import { expect, it, vi } from 'vitest';
import { LOCALES, MESSAGES } from '@playerone/api/i18n';
import { BackOfficeScreen, backOfficeSearch } from './BackOffice.tsx';
import { DraftRestored } from '../components/ui/DraftRestored.tsx';

let locale: (typeof LOCALES)[number] = 'en';
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: keyof typeof MESSAGES.en) => MESSAGES[locale][key] ?? key }),
}));
vi.mock('../components/shell/AppShell.tsx', () => ({ AppShell: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('../lib/profile-api.ts', () => ({ useOperatorProfile: () => ({ data: { operator: { id: 'op-1', role: 'administrator', status: 'active' } } }) }));
vi.mock('../lib/api.ts', async (original) => {
  const real = await original<typeof import('../lib/api.ts')>();
  return { ...real, backOffice: { ...real.backOffice, tasks: async () => ({ tasks: [] }), collectors: async () => ({ collectors: [], required_agreements: [] }), devices: async () => ({ devices: [], device_types: [] }) } };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};
window.matchMedia = vi.fn().mockImplementation(() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

it('keeps the selected tab in the URL and returns to it with browser Back', async () => {
  const history = createMemoryHistory({ initialEntries: ['/backoffice?tab=devices'] });
  const rootRoute = createRootRoute({ component: Outlet });
  const route = createRoute({ getParentRoute: () => rootRoute, path: '/backoffice', validateSearch: backOfficeSearch, component: BackOfficeScreen });
  const router = createRouter({ routeTree: rootRoute.addChildren([route]), history });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => {
    await router.load();
    root.render(<QueryClientProvider client={client}><RouterProvider router={router} /></QueryClientProvider>);
  });
  const selected = () => host.querySelector('[role="tab"][aria-selected="true"]')?.textContent;
  expect(selected()).toBe(MESSAGES.en['bo.tab.devices']);
  await act(async () => { (host.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click(); });
  expect(history.location.search).toContain('tab=collectors');
  expect(selected()).toBe(MESSAGES.en['bo.tab.collectors']);
  await act(async () => { history.back(); });
  expect(selected()).toBe(MESSAGES.en['bo.tab.devices']);
  expect(backOfficeSearch({ tab: 'devices', new: true })).toEqual({ tab: 'devices' });
  expect(backOfficeSearch({ tab: 'tasks', new: true })).toEqual({ tab: 'tasks', new: true });
  expect(backOfficeSearch({ tab: 'invalid', new: 'bad' })).toEqual({});
  await act(async () => { await router.navigate({ to: '/backoffice', search: { tab: 'tasks', new: true } }); });
  await vi.waitFor(async () => {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(host.querySelector('input')).not.toBeNull();
  });
  const draftKey = 'playerone.console.draft.op-1.task-assign';
  const originalId = JSON.parse(sessionStorage.getItem(draftKey)!).value.taskId;
  await act(async () => {
    const input = host.querySelector('input')!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Morning collection');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(JSON.parse(sessionStorage.getItem(draftKey)!).value.name).toBe('Morning collection');
  await act(async () => { (host.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click(); });
  await act(async () => { (host.querySelectorAll('[role="tab"]')[0] as HTMLButtonElement).click(); });
  await act(async () => {
    [...host.querySelectorAll('button')].find((button) => button.textContent === MESSAGES.en['bo.task.new'])!.click();
  });
  expect(host.querySelector('input')?.value).toBe('Morning collection');
  expect(JSON.parse(sessionStorage.getItem(draftKey)!).value.taskId).toBe(originalId);
  await act(async () => root.unmount());
  sessionStorage.clear();
  client.clear();
});

it.each(LOCALES)('renders the restored draft notice and discard action in %s', async (language) => {
  locale = language;
  const host = document.createElement('div');
  const root = createRoot(host);
  const discard = vi.fn();
  await act(async () => root.render(<DraftRestored onDiscard={discard} />));
  expect(host.querySelector('[role="status"]')?.textContent).toContain(MESSAGES[language]['draft.restored']);
  expect(host.querySelector('button')?.textContent).toBe(MESSAGES[language]['draft.discard']);
  await act(async () => host.querySelector('button')!.click());
  expect(discard).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
  locale = 'en';
});
