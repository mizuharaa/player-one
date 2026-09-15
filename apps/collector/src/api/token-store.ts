import * as SecureStore from 'expo-secure-store';

/**
 * Where the collector's token lives between two runs of the app.
 *
 * This is the whole of NFR-03/NFR-04 in this directory. Before it, the app had
 * no persistent storage of any kind — React Native 0.82 removed AsyncStorage
 * from core, and there is no MMKV, no Expo module and no filesystem module in
 * `package.json` — so killing the app lost the session along with everything
 * else. Only the token is kept. Claims, devices, sessions, episodes and income
 * are refetched from the server on the next cold start, because the server is
 * the record and a phone's copy of it is a guess about what happened while the
 * phone was closed.
 *
 * The interface exists for one reason and it is not flexibility:
 * `expo-secure-store` is a native module and cannot be loaded under Node, so
 * `test/http-api.test.ts` passes a plain object over one variable instead. The
 * real implementation is the only one that ships.
 *
 * **Nothing but `App.tsx` imports this file.** Anything a vitest test reaches
 * transitively must not pull a native module in.
 *
 * The interface is "one string in the keystore", so the runtime API origin
 * (`origin.ts`) uses the same shape under its own key. Two keys, one
 * accessor; not a storage layer.
 */
export interface TokenStore {
  get(): Promise<string | null>;
  set(token: string): Promise<void>;
  clear(): Promise<void>;
}

const KEY = 'playerone.collector.token';

export const secureTokenStore: TokenStore = {
  get: () => SecureStore.getItemAsync(KEY),
  set: (token) => SecureStore.setItemAsync(KEY, token),
  clear: () => SecureStore.deleteItemAsync(KEY),
};

/**
 * The runtime API origin override; see `origin.ts` for why it exists. Its own
 * key, so clearing a session never clears the server and vice versa.
 */
const ORIGIN_KEY = 'playerone.collector.origin';

export const secureOriginStore: TokenStore = {
  get: () => SecureStore.getItemAsync(ORIGIN_KEY),
  set: (origin) => SecureStore.setItemAsync(ORIGIN_KEY, origin),
  clear: () => SecureStore.deleteItemAsync(ORIGIN_KEY),
};
