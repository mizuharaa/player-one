/**
 * The one refusal the delivery state machine throws, carrying a code and never
 * a sentence.
 *
 * It lived in `apps/collector/src/api/types.ts` until the console needed the
 * state machine too. Moving it here rather than injecting a factory is the
 * smaller change of the two: `delivery.ts` throws it, the collector's HTTP
 * client and its mock throw it, and a screen that catches one must catch the
 * other — so there is exactly one class, in the package both apps already
 * depend on. `api/types.ts` re-exports it, so nothing in the collector had to
 * change its import.
 *
 * The code is a name a screen looks up (`i18n.ts` in the collector,
 * `REASON_KEYS` in the console's debug page); the server's own refusal
 * constraints are already client-facing names rather than database constraint
 * names, so both clients pass them straight through.
 */
export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
