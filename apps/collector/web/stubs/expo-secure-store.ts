/**
 * `expo-secure-store`, for the browser harness only.
 *
 * The real module is a native one and there is no keystore in a browser. This
 * stub is memory-only on purpose: a harness that remembered a token or a
 * "guide already offered" flag between reloads would quietly change what the
 * screenshots show, and the first screen it would hide is the landing.
 *
 * It never ships. `vite.config.ts` in this directory is the only thing that
 * points at it.
 */
const store = new Map<string, string>();

export const getItemAsync = (key: string): Promise<string | null> =>
  Promise.resolve(store.get(key) ?? null);

export const setItemAsync = (key: string, value: string): Promise<void> => {
  store.set(key, value);
  return Promise.resolve();
};

export const deleteItemAsync = (key: string): Promise<void> => {
  store.delete(key);
  return Promise.resolve();
};
