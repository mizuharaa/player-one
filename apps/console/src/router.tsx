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
import { HomeScreen } from './routes/Home.tsx';
import { ReviewScreen } from './routes/Review.tsx';
import { PipelineScreen } from './routes/Pipeline.tsx';
import { LoginScreen } from './routes/Login.tsx';
import { NotBuiltScreen } from './routes/NotBuilt.tsx';
import { BackOfficeScreen } from './routes/BackOffice.tsx';

const rootRoute = createRootRoute({ component: Outlet });

/**
 * The session check.
 *
 * The cookies are `HttpOnly`, so the client cannot read them to find out
 * whether it is signed in — it has to ask. `/whoami` is the cheapest question
 * that answers it, and a 401 from any screen's own data fetch reaches the same
 * place through the error boundary.
 *
 * It also answers *what* the caller is. A PLT-10 reviewer session reaches the
 * review lane and gets 403 from everything else, so sending one to the home
 * screen renders a page of refusals; they go to `/review` instead. The
 * redirect is a convenience on top of the server's rule and not the rule
 * itself — the API refuses those routes whatever this file does.
 */
async function requireSession({ location }: { location: { pathname: string } }) {
  const res = await fetch('/whoami', { credentials: 'same-origin' });
  if (res.status === 401 || res.status === 403) {
    throw redirect({ to: '/login' });
  }
  const who = (await res.json().catch(() => ({}))) as { role?: string };
  if (who.role === 'reviewer' && location.pathname !== '/review') {
    throw redirect({ to: '/review' });
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

/** BO-01 to BO-04, on one screen: tasks, collectors and devices. */
const backOfficeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/backoffice',
  beforeLoad: requireSession,
  component: BackOfficeScreen,
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
  backOfficeRoute,
  pipelineRoute,
  counterRoute,
  episodesRoute,
  settleRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
