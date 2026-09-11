import { AGREEMENTS, ApiError, type CollectorApi } from './types.ts';
import type { Route } from '../nav.tsx';

export type SessionEntry = Route | 'out' | 'unavailable';

/** A failed profile read is unknown state, never evidence of missing registration. */
export async function sessionEntry(api: CollectorApi): Promise<SessionEntry> {
  try {
    if (!await api.restoreSession()) return 'out';
    const me = await api.profile();
    if (me === null || me.name === '') return { name: 'register' };
    if (me.agreements.length < AGREEMENTS.length) return { name: 'agreements' };
    if (!me.trainingDone) return { name: 'training' };
    if (!me.examPassed) return { name: 'exam' };
    return { name: 'home' };
  } catch (error) {
    return error instanceof ApiError && error.code === 'unauthorized' ? 'out' : 'unavailable';
  }
}
