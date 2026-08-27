/**
 * Whether this session may pay, asked once and kept for the session.
 *
 * The answer decides only what the screens *show*: every action is rendered
 * for everybody, and a session without the role sees it disabled with the
 * reason beside it. The server refuses regardless — the role is read from
 * `operators.role` on every mutating request — so a stale answer here costs a
 * 409 sentence and never a payment.
 */
import { useQuery } from '@tanstack/react-query';
import { payout, type FinanceRole } from '../lib/api.ts';
import { keys } from './period.ts';

export function useFinanceRole(): { role: FinanceRole; isPending: boolean } {
  const { data, isPending } = useQuery({
    queryKey: keys.role,
    queryFn: payout.financeRole,
    staleTime: 5 * 60_000,
    gcTime: 60 * 60_000,
  });
  return { role: data ?? 'unknown', isPending };
}

/** The catalogue key that says why an action is disabled for this role, or null when it is not. */
export function readOnlyReason(role: FinanceRole): string | null {
  if (role === 'finance') return null;
  return role === 'operator' ? 'settle.readonly.operator' : 'settle.readonly.unknown';
}
