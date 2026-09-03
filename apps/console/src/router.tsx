/**
 * Routing, declared in code rather than generated from a file tree.
 *
 * TanStack Router's file-based mode wants a generator step and a
 * `routeTree.gen.ts` in the repo; six routes do not earn that. This file is the
 * whole map and it fits on a screen.
 */
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { HomeScreen } from './routes/Home.tsx';
import { ReviewScreen } from './routes/Review.tsx';
import { PipelineScreen } from './routes/Pipeline.tsx';
import { LoginScreen } from './routes/Login.tsx';
import { NotBuiltScreen } from './routes/NotBuilt.tsx';
import { Problem } from './components/ui/primitives.tsx';
import { Button } from './components/ui/button.tsx';

const rootRoute = createRootRoute({ component: Outlet });

/**
 * What a reviewer sees when the route itself cannot load.
 *
 * The only way to reach this is `requireSession` failing to reach `/whoami` at
 * all — the API is down, or the centre LAN dropped. Without it TanStack Router
 * renders its own developer default, "Something went wrong! Hide Error /
 * Failed to fetch", which is untranslated, names no recovery, and offers a
 * reviewer in Shenzhen an English stack-trace toggle.
 */
function RouteProblem() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-[46rem] px-4 py-16">
      <Problem
        title={t('state.offline.title')}
        body={t('state.offline.body')}
        action={
          // ponytail: a full reload, because the failure is "this machine cannot
          // reach the API" and there is no partial state worth preserving. Swap
          // for the router's `reset` if a route ever fails for a narrower reason.
          <Button variant="primary" onClick={() => window.location.reload()}>
            {t('state.writeFailed.retry')}
          </Button>
        }
      />
    </div>
  );
}

/**
 * The session check.
 *
 * The cookies are `HttpOnly`, so the client cannot read them to find out
 * whether it is signed in — it has to ask. `/whoami` is the cheapest question
 * that answers it, and a 401 from any screen's own data fetch reaches the same
 * place through the error boundary.
 */
async function requireSession() {
  const res = await fetch('/whoami', { credentials: 'same-origin' });
  if (res.status === 401 || res.status === 403) {
    throw redirect({ to: '/login' });
  }
}

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginScreen,
});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: requireSession,
  component: HomeScreen,
});

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/review',
  beforeLoad: requireSession,
  component: ReviewScreen,
});

const pipelineRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pipeline',
  beforeLoad: requireSession,
  component: PipelineScreen,
});

/**
 * The three destinations that exist in the product and not yet in the code.
 *
 * They route to a page that says what the surface is for, which requirement IDs
 * it covers, and how the work is done today — rather than 404ing or, worse,
 * showing an empty table that looks like a bug.
 */
const counterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/counter',
  beforeLoad: requireSession,
  component: () => <NotBuiltScreen surface="counter" />,
});

const episodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/episodes',
  beforeLoad: requireSession,
  component: () => <NotBuiltScreen surface="episodes" />,
});

const settleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settle',
  beforeLoad: requireSession,
  component: () => <NotBuiltScreen surface="settle" />,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  loginRoute,
  reviewRoute,
  pipelineRoute,
  counterRoute,
  episodesRoute,
  settleRoute,
]);

export const router = createRouter({
  routeTree,
  defaultPreload: 'intent',
  defaultErrorComponent: RouteProblem,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
