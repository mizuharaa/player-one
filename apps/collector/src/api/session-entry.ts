import { AGREEMENTS, ApiError, type CollectorApi } from './types.ts';
import type { Route } from '../nav.tsx';

export type SessionEntry = Route | 'out' | 'unavailable' | 'offline';

/** A failed profile read is unknown state, never evidence of missing registration. */
export async function sessionEntry(api: CollectorApi): Promise<SessionEntry> {
  try {
    if (!await api.restoreSession()) return 'out';
    const me = await api.profile();
    if (me === null || me.name === '') return { name: 'register' };
    /**
     * Somebody who signed up in the app opens on Home once they have a name,
     * and not on the six agreements.
     *
     * That is the whole point of open sign-up (owner's decision 2026-09-15):
     * the app advertises the service, and a person who has not been to a
     * collection centre yet is here to look. Home is where the tab bar is, so
     * Explore is one tap away — and the agreements, training and the exam are
     * still reachable, from Profile and from Home, for when they decide to go
     * through with it.
     *
     * A collector an operator enrolled keeps the exact chain below: APP-01 →
     * APP-02 → APP-03 → APP-04, in the order `task_claims_guard` wants them.
     */
    if (!me.onboarded) return { name: 'home' };
    if (me.agreements.length < AGREEMENTS.length) return { name: 'agreements' };
    if (!me.trainingDone) return { name: 'training' };
    if (!me.examPassed) return { name: 'exam' };
    return { name: 'home' };
  } catch (error) {
    if (error instanceof ApiError && error.code === 'server_unreachable') return 'offline';
    return error instanceof ApiError && error.code === 'unauthorized' ? 'out' : 'unavailable';
  }
}
