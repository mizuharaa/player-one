import { beforeEach, describe, expect, it } from 'vitest';
import { API_BASE_URL } from '../src/api/config.ts';
import { getApiOrigin, loadApiOrigin, originOf, setApiOrigin } from '../src/api/origin.ts';

/**
 * The runtime API origin.
 *
 * One TestFlight build has to reach a laptop on a hotspot today and the
 * Vietnam cloud later, without being rebuilt — so the origin the client uses
 * is a stored value with the build's own as its default. That makes it a trust
 * boundary: whatever is in the keystore is pasted in front of every route in
 * `http.ts`, so a value carrying a path, a query, credentials or a `file:`
 * scheme must never come back out of this module.
 *
 * The store is the same shape as `TokenStore` and is faked here for the same
 * reason `api.test.ts` fakes that one: `expo-secure-store` is a native module
 * and cannot load under Node.
 */
function fakeStore(initial: string | null = null) {
  let held = initial;
  return {
    get: async () => held,
    set: async (value: string) => { held = value; },
    clear: async () => { held = null; },
    value: () => held,
  };
}

describe('the stored API origin', () => {
  beforeEach(async () => {
    await loadApiOrigin(fakeStore());
  });

  it('falls back to the origin this build was compiled with', () => {
    expect(getApiOrigin()).toBe(API_BASE_URL);
  });

  it('reads the override once at boot and answers synchronously afterwards', async () => {
    await loadApiOrigin(fakeStore('http://192.168.1.10:8080'));
    // No await: every request site calls this, and a request cannot wait on a
    // keystore read.
    expect(getApiOrigin()).toBe('http://192.168.1.10:8080');
    expect(getApiOrigin()).toBe('http://192.168.1.10:8080');
  });

  it('accepts an HTTP or HTTPS host with an optional port and nothing else', () => {
    for (const value of [
      'http://192.168.1.10:8080',
      'https://api.playerone.vng.com.vn',
      'http://localhost:8080',
      'https://demo.example.org:443',
    ]) expect(originOf(value)).toBe(value);
    // Surrounding whitespace is what a paste off a chat message carries.
    expect(originOf('  http://192.168.1.10:8080 ')).toBe('http://192.168.1.10:8080');
  });

  it('refuses anything that is not a bare origin', () => {
    for (const value of [
      '',
      '192.168.1.10:8080',
      'ftp://192.168.1.10',
      'file:///etc/passwd',
      'http://192.168.1.10:8080/',
      'http://192.168.1.10:8080/api',
      'http://192.168.1.10:8080?x=1',
      'http://192.168.1.10:8080#x',
      'http://user:pass@192.168.1.10',
      'http://192.168.1.10:0',
      'http://192.168.1.10:70000',
      'http://192.168.1.10 8080',
      'http://',
    ]) expect(originOf(value), value).toBeNull();
  });

  it('ignores a stored value that is no longer a usable origin', async () => {
    await loadApiOrigin(fakeStore('http://192.168.1.10:8080/api'));
    expect(getApiOrigin()).toBe(API_BASE_URL);
  });

  it('persists a new origin and keeps the old one when the new one is refused', async () => {
    const store = fakeStore();
    await loadApiOrigin(store);
    await setApiOrigin('http://192.168.1.10:8080');
    expect(store.value()).toBe('http://192.168.1.10:8080');
    expect(getApiOrigin()).toBe('http://192.168.1.10:8080');

    await expect(setApiOrigin('http://192.168.1.10:8080/api')).rejects.toThrow();
    expect(getApiOrigin()).toBe('http://192.168.1.10:8080');
    expect(store.value()).toBe('http://192.168.1.10:8080');
  });

  it('goes back to the build default when the override is removed', async () => {
    const store = fakeStore('https://api.playerone.vng.com.vn');
    await loadApiOrigin(store);
    await setApiOrigin(null);
    expect(store.value()).toBeNull();
    expect(getApiOrigin()).toBe(API_BASE_URL);
  });
});
