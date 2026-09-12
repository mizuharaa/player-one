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
import { ProfileScreen } from './routes/Profile.tsx';
import { ShowcaseScreen } from './showcase/ShowcaseScreen.tsx';
import { EngineeringScreen } from './engineering/EngineeringScreen.tsx';
import { ReviewScreen } from './routes/Review.tsx';
import { PipelineScreen } from './routes/Pipeline.tsx';
import { LoginScreen } from './routes/Login.tsx';
import { DiscoverScreen } from './routes/Discover.tsx';
import { PrivacyScreen } from './routes/Privacy.tsx';
import { NotFoundScreen } from './routes/NotFound.tsx';
import { EpisodesScreen, episodeSearch } from './routes/Episodes.tsx';
import { EpisodeAttentionScreen } from './routes/EpisodeAttention.tsx';
import { CounterScreen } from './routes/Counter.tsx';
import { BackOfficeScreen } from './routes/BackOffice.tsx';
import { SettleScreen } from './payout/SettleScreen.tsx';
import { PreflightScreen } from './payout/PreflightScreen.tsx';
import { BillScreen } from './payout/BillScreen.tsx';
import { ExceptionsScreen } from './payout/ExceptionsScreen.tsx';
import { RiskScreen } from './risk/RiskScreen.tsx';
import { periodSearch, riskSearch } from './payout/period.ts';

/**
 * The root, and it now owns the not-found page.
 *
 * `notFoundComponent` here rather than `defaultNotFoundComponent` on the
 * router: declared on the root route it covers a URL that matches nothing at
 * all *and* a `notFound()` thrown from any child, and it renders inside the
 * root's own `Outlet` so a future root layout would wrap it the way it wraps
 * every other screen. The router-level option is a fallback for routes that
 * do not declare one, which — with one root — is the same set by a longer
 * road.
 *
 * It is a **page and not a redirect** on purpose. An operator who typed
 * `/setle` and was bounced silently to the product story would conclude the
 * console had lost their screen; the address has to be named as wrong.
 */
const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFoundScreen });

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
 *
 * **Where a refused visit lands depends on which door it knocked on.** A
 * returning operator who typed `/settle` wants the form, so they get `/login`
 * and nothing between them and it. Somebody who typed the bare origin has told
 * us nothing about themselves and is more likely to be new, so `/` goes to
 * `/discover` — the product story — with sign-in one click away in its bar.
 *
 * That split is the whole of the route change made on 2026-09-08. Before it,
 * the story WAS the sign-in screen: 180vh of landing above the form, which an
 * operator had to scroll or skip past on every visit to an internal console.
 */
async function requireSession({ location }: { location: { pathname: string } }) {
  const res = await fetch('/whoami', { credentials: 'same-origin' });
  if (res.status === 401 || res.status === 403) {
    throw redirect({ to: location.pathname === '/' ? '/discover' : '/login' });
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

/**
 * The product story, on a public route of its own.
 *
 * It used to be the top four fifths of `/login`. Splitting it is the auditor's
 * finding and the product owner's complaint agreeing: an internal console must
 * not put a sales presentation between a returning operator and a password
 * box, and a story worth telling should not have to live inside a form.
 */
const discoverRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/discover',
  component: DiscoverScreen,
});
const privacyRoute = createRoute({getParentRoute:()=>rootRoute,path:'/privacy',component:PrivacyScreen});

const homeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: requireSession,
  component: HomeScreen,
});

const profileRoute = createRoute({ getParentRoute: () => rootRoute, path: '/profile', beforeLoad: requireSession, component: ProfileScreen });
const showcaseRoute = createRoute({ getParentRoute: () => rootRoute, path: '/showcase', beforeLoad: requireSession, component: ShowcaseScreen });
const engineeringRoute = createRoute({ getParentRoute: () => rootRoute, path: '/engineering', beforeLoad: requireSession, component: EngineeringScreen });

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
 * The counter: the card-intake wizard (BO-10).
 *
 * It used to route to the not-built page under ADR 0003. That ADR's cut is
 * **BO-09** — creating upload centres, binding machines and operators — and it
 * says so in its own title and its own decision. The handover lane is BO-10,
 * `POST /handovers` and `POST /handovers/:id/sessions` have been built and
 * tested since `counter.ts` landed, and nothing in the ADR reserves this path
 * for the screen it eventually owes. So the stub is gone and the endpoints
 * have a face. If BO-09's screen is ever built, the ADR's own item 3 offers
 * `/centres` as the alternative and that is where it goes.
 */
const counterRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/counter',
  beforeLoad: requireSession,
  component: CounterScreen,
});

/**
 * `/episodes` is BO-05, and `/episodes/attention` is the counter lane's own view.
 *
 * Two screens were built against this path on two branches, and both survive
 * because they answer different questions over different endpoints.
 *
 * - `/episodes` browses every episode by task, collector, device, status and
 *   recording time, over `GET /api/episodes`. That endpoint did not exist when
 *   the attention screen was written, which is the whole reason that screen
 *   said on its face that BO-05 was not built; it exists now, so BO-05 keeps
 *   the plain path and the navigation stops calling itself `partial`.
 * - `/episodes/attention` is what is *blocking*, over
 *   `GET /upload-batches/:id/exceptions` (one machine, one batch) and
 *   `GET /episodes/stuck` (the whole centre). Nothing in the browse screen
 *   answers either one, so it is not superseded and was not dropped.
 *
 * The attention screen carries no navigation entry of its own on purpose —
 * `AppShell` already resolves any `/episodes` prefix to `nav.episodes`, so
 * giving it a second dot would need a fourth translation of a label for a
 * screen an operator reaches from the counter lane, not from the top bar.
 */
const episodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/episodes',
  beforeLoad: requireSession,
  validateSearch: episodeSearch,
  component: EpisodesScreen,
});

const episodeAttentionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/episodes/attention',
  beforeLoad: requireSession,
  component: EpisodeAttentionScreen,
});

/**
 * Settle and the payout console (SET-03 → SET-07, the payout brief's Agent D).
 *
 * Four screens and one seam: the period travels in `?period=` on every one of
 * them, validated by `periodSearch` so a link opens the same batch for whoever
 * follows it. The order below is the order an operator works in — the bills,
 * the preflight that has to be read before any payment, the flags, and the
 * attempts that need a person.
 */
const settleRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settle',
  beforeLoad: requireSession,
  validateSearch: periodSearch,
  component: SettleScreen,
});

const preflightRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settle/preflight',
  beforeLoad: requireSession,
  validateSearch: periodSearch,
  component: PreflightScreen,
});

const billRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settle/bills/$billId',
  beforeLoad: requireSession,
  validateSearch: periodSearch,
  component: BillScreen,
});

const exceptionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settle/exceptions',
  beforeLoad: requireSession,
  validateSearch: periodSearch,
  component: ExceptionsScreen,
});

const riskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/risk',
  beforeLoad: requireSession,
  validateSearch: riskSearch,
  component: RiskScreen,
});

const routeTree = rootRoute.addChildren([
  homeRoute,
  profileRoute,
  showcaseRoute,
  engineeringRoute,
  loginRoute,
  discoverRoute,
  privacyRoute,
  reviewRoute,
  backOfficeRoute,
  pipelineRoute,
  counterRoute,
  episodesRoute,
  episodeAttentionRoute,
  settleRoute,
  preflightRoute,
  billRoute,
  exceptionsRoute,
  riskRoute,
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
