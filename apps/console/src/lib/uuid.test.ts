import { afterEach, describe, expect, it, vi } from 'vitest';
import { uuid } from './uuid.ts';

/**
 * The bug this exists to keep out.
 *
 * `crypto.randomUUID` is defined only in a secure context — HTTPS or
 * `localhost`. An upload centre reaches this console over its own network, and
 * `http://172.31.57.74:5190` is neither, so `/review` and `/counter` both threw
 * `crypto.randomUUID is not a function` and rendered nothing. The id these
 * screens mint is the key behind `episode_reviews_verdict_key` and the
 * counter's replay contract, so a screen that cannot mint one cannot take a
 * verdict.
 *
 * Each case below removes one layer and checks the next one still produces a
 * real v4, because the fallbacks are the whole point and a fallback nobody
 * exercises is a fallback that does not work.
 */
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const withCrypto = (value: unknown) =>
  vi.spyOn(globalThis, 'crypto', 'get').mockReturnValue(value as Crypto);

afterEach(() => vi.restoreAllMocks());

describe('minting an id works in every context this console runs in', () => {
  it('uses the platform generator on a secure origin', () => {
    const spy = vi.fn(() => '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    withCrypto({ randomUUID: spy, getRandomValues: () => new Uint8Array(16) });
    expect(uuid()).toBe('3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    expect(spy).toHaveBeenCalledOnce();
  });

  it('falls back to getRandomValues on a plain-HTTP LAN address, which is the reported crash', () => {
    /*
     * `getRandomValues` is NOT restricted to secure contexts — only
     * `randomUUID` and `subtle` are — so this branch still has a real
     * cryptographic source and is the one that actually runs at an upload
     * centre.
     */
    const spy = vi.fn((a: Uint8Array) => {
      for (let i = 0; i < a.length; i += 1) a[i] = i * 17;
      return a;
    });
    withCrypto({ getRandomValues: spy });
    const id = uuid();
    expect(id).toMatch(V4);
    expect(spy).toHaveBeenCalledOnce();
  });

  it('still produces a v4 with no WebCrypto at all', () => {
    withCrypto(undefined);
    expect(uuid()).toMatch(V4);
  });

  it('sets the version and variant bits the API validates', () => {
    withCrypto({ getRandomValues: (a: Uint8Array) => a.fill(0xff) });
    const id = uuid();
    /* All bits high: version must still read 4, variant must still read 10xx. */
    expect(id[14]).toBe('4');
    expect('89ab').toContain(id[19]);
    expect(id).toMatch(V4);
  });

  it('does not repeat itself', () => {
    /*
     * The stub fills in place. Written first as `a.map(...)`, which returns a
     * *new* array and leaves the buffer at zero — so every id came out
     * identical and this case caught it. That is the failure it exists for.
     */
    withCrypto({
      getRandomValues: (a: Uint8Array) => {
        for (let i = 0; i < a.length; i += 1) a[i] = Math.floor(Math.random() * 256);
        return a;
      },
    });
    const seen = new Set(Array.from({ length: 500 }, () => uuid()));
    expect(seen.size).toBe(500);
  });
});
