/**
 * Financial reads and actions require the stored finance role. Reuse the
 * current operator profile, not the transport role from /whoami or a mutation
 * probe. The server independently checks its current role on every request.
 */
import type { FinanceRole } from '../lib/api.ts';
import { useOperatorProfile } from '../lib/profile-api.ts';

export function useFinanceRole(): { role: FinanceRole; isPending: boolean } {
  const { data, isPending, isError } = useOperatorProfile();
  const storedRole = !isError && data?.operator.status === 'active' ? data.operator.role : undefined;
  return { role: storedRole === 'finance' ? 'finance' : storedRole ? 'operator' : 'unknown', isPending };
}

/** The catalogue key that says why an action is disabled for this role, or null when it is not. */
export function readOnlyReason(role: FinanceRole): string | null {
  if (role === 'finance') return null;
  return role === 'operator' ? 'settle.readonly.operator' : 'settle.readonly.unknown';
}
