import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import './styles/globals.css';
import { i18n, applyHtmlLang, type Locale } from './lib/i18n.ts';
import { applyStoredTheme } from './components/shell/ThemeSwitch.tsx';
import { router } from './router.tsx';
import { ApiError } from './lib/api.ts';

/**
 * Theme and language are applied before the first paint.
 *
 * Doing this inside a component means the shell renders once in the wrong
 * theme and then corrects itself — a white flash on a reviewer's night shift,
 * and a `lang` attribute that is briefly wrong for a screen reader.
 */
applyStoredTheme();
applyHtmlLang(i18n.language as Locale);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      /**
       * Nothing on this surface is worth a background refetch on window focus.
       * A reviewer alt-tabs to check a note and comes back; refetching the
       * claimed episode underneath them would replace the thing they are part
       * way through judging.
       */
      refetchOnWindowFocus: false,
      staleTime: 15_000,
      retry: (failureCount, error) => {
        /**
         * An expired session or a lost lease is a state, not a transient
         * failure — retrying either just delays the screen that explains what
         * happened. Everything else gets two attempts, because an upload centre
         * LAN drops packets.
         */
        if (
          error instanceof ApiError &&
          (error.isUnauthenticated || error.isReassigned || error.isWithheld)
        ) {
          return false;
        }
        return failureCount < 2;
      },
    },
    mutations: { retry: 0 },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
