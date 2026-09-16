/**
 * Financial reads and actions require the stored finance role. Reuse the
 * current operator profile, not the transport role from /whoami or a mutation
 * probe. The server independently checks its current role on every request.
 *
 * Two questions, not one. Reading a bill and paying it were the same
 * expression here — `role === 'finance'` gated both the queries and the
 * buttons — which is why the demo's single administrator credential saw an
 * empty settlement screen. `canReadFinance` is the read; `readOnlyReason` is
 * the action, and it still disables every control for an administrator with
 * the sentence a counter operator already gets.
 */
import type { FinanceRole } from '../lib/api.ts';
import { useOperatorProfile } from '../lib/profile-api.ts';

export function useFinanceRole(): { role: FinanceRole; isPending: boolean } {
  const { data, isPending, isError } = useOperatorProfile();
  const storedRole = !isError && data?.operator.status === 'active' ? data.operator.role : undefined;
  return {
    role: storedRole === 'finance' || storedRole === 'administrator' ? storedRole : storedRole ? 'operator' : 'unknown',
    isPending,
  };
}

/** May this role see the money screens? Finance, and the administrator. */
export function canReadFinance(role: FinanceRole): boolean {
  return role === 'finance' || role === 'administrator';
}

/** The catalogue key that says why an action is disabled for this role, or null when it is not. */
export function readOnlyReason(role: FinanceRole): string | null {
  if (role === 'finance') return null;
  /**
   * The administrator gets its own sentence, because the operator's one is not
   * true of it. `financeReadGuard` lets an administrator READ every figure on
   * these screens, and it does — so "only finance accounts can view bills"
   * printed above a bill table an administrator is looking at is a visible
   * falsehood, measured on the demo build on 2026-09-16. Both roles still get
   * every control disabled; only the reason differs.
   */
  if (role === 'administrator') return 'settle.readonly.administrator';
  return role === 'operator' ? 'settle.readonly.operator' : 'settle.readonly.unknown';
}
