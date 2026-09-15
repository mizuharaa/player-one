import { API_BASE_URL } from './config.ts';
import type { TokenStore } from './token-store.ts';

/**
 * Which server this phone talks to, decided on the phone.
 *
 * `config.ts`'s `EXPO_PUBLIC_API_URL` is inlined by the bundler, so it names
 * one server for the life of a build. The Vietnam cloud does not exist yet and
 * the owner has to smoke-test the same TestFlight build against a laptop on a
 * hotspot today and against the cloud later — two servers, one build, no
 * rebuild in between. So the build's origin becomes the DEFAULT and the
 * keystore may hold an override.
 *
 * Read once at boot and cached in this module: `getApiOrigin()` is called on
 * the way into building the session's client and a client cannot wait on a
 * keystore read. `App.tsx` awaits `loadApiOrigin` on the same boot path that
 * already awaits the token, before the first client exists.
 *
 * ponytail: no settings framework, no second copy of the value in React state.
 * One string in the keystore under one key, and the screen that edits it reads
 * this module.
 *
 * The store is injected rather than imported, for the reason written on
 * `token-store.ts`: `expo-secure-store` is a native module, nothing a vitest
 * test reaches transitively may pull one in, and both the Profile screen and
 * `http.ts` reach this file.
 */

/**
 * Whatever is stored here is pasted in front of every route in `http.ts`, so
 * this is a trust boundary and the check is deliberately narrow: scheme, host,
 * optional port, end of string. A value carrying a path, a query, a fragment
 * or credentials is refused rather than trimmed — silently dropping half of
 * what somebody typed is how a phone ends up talking to a server nobody meant.
 *
 * A regex rather than `new URL`: React Native's `URL` is a partial polyfill
 * and does not parse reliably on Hermes, and this is the same rule
 * `app.config.cjs` applies to `EXPO_PUBLIC_API_URL` at build time.
 */
const ORIGIN = /^https?:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*(?::(\d{1,5}))?$/i;

/** The origin as it will be used, or `null` if it is not one. */
export function originOf(raw: string): string | null {
  const value = raw.trim();
  const match = ORIGIN.exec(value);
  if (match === null) return null;
  const port = match[1];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) return null;
  return value;
}

/** `null` until `loadApiOrigin` has run, which on a phone is before boot ends. */
let store: TokenStore | null = null;
let override: string | null = null;

/**
 * Boot: read the override back. A stored value that no longer validates is
 * ignored rather than trusted — the check can only get stricter.
 */
export async function loadApiOrigin(from: TokenStore): Promise<void> {
  store = from;
  const stored = await from.get();
  override = stored === null ? null : originOf(stored);
}

export function getApiOrigin(): string {
  return override ?? API_BASE_URL;
}

/**
 * `null` removes the override and returns the build to its own origin.
 *
 * Validated here as well as in the screen that calls it: the screen's check is
 * there to print a message, this one is there because this is what writes the
 * keystore.
 */
export async function setApiOrigin(value: string | null): Promise<void> {
  if (value === null) {
    override = null;
    await store?.clear();
    return;
  }
  const origin = originOf(value);
  if (origin === null) throw new Error('Not an API origin');
  override = origin;
  await store?.set(origin);
}
