/**
 * The hero demo's money, so the figure on the receipt is the rule doing its
 * work rather than a number somebody typed.
 *
 * The receipt said `+ 12.000 ₫` beside an effective time of `00:18`. At the
 * pilot's 1,200 ₫ per reviewed minute that is 360 ₫; 12,000 ₫ would be a rate
 * of 40,000 ₫ a minute. The captions under the window say "paid per effective
 * minute" and the demo's own verdict panel prints the 18 seconds, so a visitor
 * who checks the arithmetic — which is exactly what a collector deciding
 * whether to sign up would do — found it did not hold.
 *
 * Ported from `ui/walkthrough-refinement` (0adf68d), narrowed to the four
 * constants and the two formatters. That file's `demoLabels` export, forty
 * strings for a mark-in/mark-out inspector, is not here; the UI it labels is
 * not in this hero.
 *
 * **Illustration only.** The live rate is a commercial decision the brief
 * leaves open, and nothing that settles money may read this file. Settlement
 * arithmetic is `packages/api/src/money.ts`, where rounding happens once.
 */
export const DEMO_RATE_VND_PER_MINUTE = 1200;

/** The sample clip's length, and all of it is effective in this walkthrough. */
export const DEMO_EFFECTIVE_SECONDS = 18;

/** Exactly the shape `money.ts` bills on: reviewed minutes × the unit price. */
export const demoAmount = (seconds: number) => (seconds / 60) * DEMO_RATE_VND_PER_MINUTE;

/** Vietnamese grouping in every locale: the dong is the number's own currency. */
export const demoVnd = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} ₫`;
