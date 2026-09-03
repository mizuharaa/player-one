/**
 * The two values that decide which platform this build talks to.
 *
 * ponytail: two constants, not a configuration system. Metro inlines
 * `process.env.X` at build time, so these are the deployment knobs and there is
 * nothing to read at runtime, nothing to parse and nothing to validate.
 *
 * `10.0.2.2` is the Android emulator's route to the host machine, and `8080` is
 * what `packages/api/bin/serve.ts` listens on by default. No trailing slash:
 * every path in `http.ts` starts with one.
 */
declare const process: { env?: Record<string, string | undefined> } | undefined;

const env = typeof process === 'undefined' ? undefined : process?.env;

export const API_BASE_URL = env?.['PLAYERONE_API_URL'] ?? 'http://10.0.2.2:8080';

/**
 * `MockCollectorApi` instead of the real client. The in-memory mock is still
 * how the screens are developed and how `test/mock-api.test.ts` exercises the
 * gates, so it stays selectable rather than deleted.
 */
export const USE_MOCK_API = env?.['PLAYERONE_MOCK_API'] === '1';
