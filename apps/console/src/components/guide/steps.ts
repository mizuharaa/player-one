/**
 * What the tour says, per route.
 *
 * The tour is not documentation and it is not onboarding-with-a-progress-bar.
 * It exists because this console has a shape an operator cannot guess: the
 * queue depth in the bar is the programme's bottleneck, the settled figure on
 * Home is that person's own decisions and not a budget, and half the
 * destinations in the nav are honest stubs. Three or four sentences per screen,
 * each one standing next to the thing it is about.
 *
 * **A step is a selector, a key and a side.** The selector is always a
 * `[data-guide="…"]` attribute, never a class or a tag: a class is a styling
 * decision and moves, and a tour that silently points at nothing is worse than
 * no tour. `key` is an i18n key in `packages/api/src/i18n.ts` and exists in all
 * three locales or the parity test fails.
 *
 * **The attribute names, for whoever is adding them.** These are the contract
 * between this file and the route files; the route tracks add the attributes
 * and nothing here invents an element:
 *
 * ```
 * shell.nav           the pill row in the top bar
 * shell.counters      queue depth and pace
 * shell.guide         the "Show me around" button itself
 * home.gauge          the shift gauge
 * home.start          the primary action, in the band at the top of Home
 * home.settled        the ink block: settled value, its sentence, its arrow
 * review.player       the video and its playhead
 * review.marks        the in / out marks
 * review.verdict      the three verdict buttons
 * review.reasons      the reason-code list
 * pipeline.stage      one stage of the ingest track
 * backoffice.tabs     tasks / collectors / devices
 * settle.period       the period picker
 * settle.bills        the bill table
 * risk.holds          the held payments
 * episodes.scope      the sentence saying which scope is on screen
 * counter.plan        the intake wizard's step rail
 * ```
 *
 * A step whose target is not on the page keeps its sentence and says so
 * instead of pointing at nothing: a screen can be empty, an empty table has no
 * rows, and a route track may not have added its attribute yet. Silently
 * dropping the step would hide both cases.
 */

export type GuidePlacement = 'top' | 'bottom' | 'left' | 'right';

export type GuideStep = {
  /** A `[data-guide="…"]` value. */
  target: string;
  /** An i18n key under `guide.`. */
  key: string;
  /** Which side of the target the card sits on, space permitting. */
  placement: GuidePlacement;
};

/**
 * Every route that has a tour, keyed by the path the router reports.
 *
 * `/review` is here deliberately and its steps are the same shape as the rest.
 * What is different about it is enforced elsewhere: the tour never starts by
 * itself there, and the panda never comes with it.
 */
export const GUIDE_STEPS: Record<string, GuideStep[]> = {
  '/': [
    { target: 'home.figures', key: 'workspace.guideSummary', placement: 'bottom' },
    { target: 'home.attention', key: 'workspace.guideWork', placement: 'bottom' },
    { target: 'home.recent', key: 'workspace.guideRecent', placement: 'top' },
    { target: 'shell.nav', key: 'guide.shell.nav', placement: 'bottom' },
  ],
  '/review': [
    { target: 'review.player', key: 'guide.review.player', placement: 'bottom' },
    { target: 'review.marks', key: 'guide.review.marks', placement: 'top' },
    { target: 'review.verdict', key: 'guide.review.verdict', placement: 'top' },
    { target: 'review.reasons', key: 'guide.review.reasons', placement: 'left' },
  ],
  '/pipeline': [{ target: 'pipeline.stage', key: 'guide.pipeline.stage', placement: 'bottom' }],
  '/backoffice': [{ target: 'backoffice.tabs', key: 'guide.backoffice.tabs', placement: 'bottom' }],
  '/settle': [
    { target: 'settle.period', key: 'guide.settle.period', placement: 'bottom' },
    { target: 'settle.bills', key: 'guide.settle.bills', placement: 'top' },
  ],
  '/risk': [{ target: 'risk.holds', key: 'guide.risk.holds', placement: 'top' }],
  '/episodes': [{ target: 'episodes.scope', key: 'guide.episodes.scope', placement: 'bottom' }],
  '/counter': [{ target: 'counter.plan', key: 'guide.counter.plan', placement: 'bottom' }],
  '/profile': [{target:'workspace.page',key:'workspace.tourProfile',placement:'top'}],
  '/showcase': [{target:'workspace.page',key:'workspace.tourShowcase',placement:'top'}],
  '/engineering': [
    {target:'engineering.services',key:'workspace.tourEngineeringServices',placement:'bottom'},
    {target:'engineering.episodes',key:'workspace.tourEngineeringEpisodes',placement:'top'},
    {target:'engineering.audit',key:'workspace.tourEngineeringAudit',placement:'top'},
  ],
  '/settle/preflight': [{target:'workspace.page',key:'workspace.tourPreflight',placement:'top'}],
  '/settle/bills': [{target:'workspace.page',key:'workspace.tourBill',placement:'top'}],
  '/settle/exceptions': [{target:'workspace.page',key:'workspace.tourExceptions',placement:'top'}],
};

/**
 * The steps for a path, longest matching prefix first.
 *
 * Dedicated subpage tours take precedence over the broader settlement tour.
 */
export function stepsFor(pathname: string): GuideStep[] {
  if (pathname === '/') return GUIDE_STEPS['/'] ?? [];
  const match = Object.keys(GUIDE_STEPS)
    .filter((route) => route !== '/' && pathname.startsWith(route))
    .sort((a, b) => b.length - a.length)[0];
  return match ? (GUIDE_STEPS[match] ?? []) : [];
}
