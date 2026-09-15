/**
 * The two values that decide which platform this build talks to.
 *
 * ponytail: two constants, not a configuration system. The bundler inlines
 * these reads at build time, so they are the deployment knobs.
 *
 * `API_BASE_URL` is the DEFAULT origin, not the only one: `origin.ts` may
 * override it from the keystore so that one TestFlight build reaches a laptop
 * today and the Vietnam cloud later. Every request site reads
 * `getApiOrigin()`; this constant is what that returns with nothing stored,
 * and what the tests measure the fallback against.
 *
 * Read `process.env.EXPO_PUBLIC_*` by **dot access**, and only that prefix.
 * That is the whole of Expo's substitution mechanism: babel-preset-expo
 * rewrites the member expression itself, so a bracket read
 * (`env?.['PLAYERONE_API_URL']`) survives into the bundle as a lookup on an
 * object Hermes has no entries in, and the fallback below is what the APK
 * actually used. Vite's `define` in `web/vite.config.ts` substitutes the same
 * dot form for the browser harness.
 *
 * The fallback belongs to the development profile alone. `app.config.cjs`
 * refuses to configure a `demo` or `play` build without `EXPO_PUBLIC_API_URL`,
 * so no installable build can reach it. `10.0.2.2` is the Android emulator's
 * route to the host machine, and `8080` is what `packages/api/bin/serve.ts`
 * listens on by default — neither is reachable from a handset, which is why a
 * phone build must be given an origin. No trailing slash: every path in
 * `http.ts` starts with one.
 */
declare const process: { env: { EXPO_PUBLIC_API_URL?: string; EXPO_PUBLIC_MOCK_API?: string; EXPO_PUBLIC_BUILD_PROFILE?: string } };

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://10.0.2.2:8080';

/**
 * `MockCollectorApi` instead of the real client. The in-memory mock is still
 * how the screens are developed and how `test/mock-api.test.ts` exercises the
 * gates, so it stays selectable rather than deleted.
 */
export const USE_MOCK_API = process.env.EXPO_PUBLIC_MOCK_API === '1';

/**
 * Mirrors `eas.json`'s build-time-only `PLAYERONE_BUILD_PROFILE` ('demo',
 * 'play', ...): `app.config.cjs` reads that one to decide `usesCleartextTraffic`
 * / `NSAllowsArbitraryLoads`, but the bundled app can only see the
 * `EXPO_PUBLIC_` prefix, so it needs its own copy to gate what still makes
 * sense once the OS has already refused plain HTTP — the Server row
 * (`Profile.tsx`) and `origin.ts`'s `http://` acceptance.
 */
export const BUILD_PROFILE = process.env.EXPO_PUBLIC_BUILD_PROFILE ?? 'demo';
