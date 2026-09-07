import * as SecureStore from 'expo-secure-store';

/**
 * Whether this collector has already been offered the guided tour.
 *
 * `expo-secure-store` is already a dependency — it is where the sign-in token
 * lives — so the flag rides in the same place rather than pulling a second
 * storage module into an app that deliberately persists almost nothing
 * (`README.md`, "Persistence"). It is not a secret, and a keystore is a heavy
 * home for a boolean; it is simply the only durable store this project has.
 *
 * A read that throws is treated as "not offered yet". The keystore is
 * unexercised on real hardware (no `expo prebuild` has run here), and the worst
 * case of getting this wrong is one extra offer, which is a card with a
 * "Không" on it.
 *
 * **This file must not be imported by anything a vitest test reaches** —
 * `expo-secure-store` is a native module and cannot load under Node. Same rule
 * as `api/token-store.ts`, for the same reason.
 */
const KEY = 'playerone.collector.guideOffered';

export const guideOffered = {
  async get(): Promise<boolean> {
    try {
      return (await SecureStore.getItemAsync(KEY)) === '1';
    } catch {
      return false;
    }
  },
  async set(): Promise<void> {
    try {
      await SecureStore.setItemAsync(KEY, '1');
    } catch {
      // Nothing to recover: the offer simply appears again next cold start.
    }
  },
};
