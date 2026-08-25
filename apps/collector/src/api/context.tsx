import { createContext, useContext } from 'react';
import type { CollectorApi } from './types.ts';

/**
 * Screens reach the API only through this context, so the whole surface runs
 * against the mock today and the HTTP client later without a screen changing.
 */
const ApiContext = createContext<CollectorApi | null>(null);

export const ApiProvider = ApiContext.Provider;

export function useApi(): CollectorApi {
  const api = useContext(ApiContext);
  if (api === null) throw new Error('useApi outside ApiProvider');
  return api;
}
