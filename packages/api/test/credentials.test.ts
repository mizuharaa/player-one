import { randomBytes, scryptSync } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashCredential, verifyCredential } from '../src/credentials.ts';

/**
 * The scrypt hash records the cost it was made at.
 *
 * It did not, and the file comment claimed N=2^15 while the code passed no
 * options at all — so every credential hash in every database was made at
 * Node's default N=2^14, at half the intended work, and nothing recorded which
 * it was. A hash with no cost field cannot be raised later without invalidating
 * every password: there is no way to tell an old hash from a new one.
 *
 * No database here. These are two pure functions.
 */

/** A three-field hash, exactly as every row written before this change holds one. */
const legacy = (secret: string): string => {
  const salt = randomBytes(16);
  // N=16384 is Node's default and therefore what those rows were made at.
  const hash = scryptSync(secret, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
};

describe('a credential hash', () => {
  it('records its cost parameters, and verifies', async () => {
    const stored = await hashCredential('correct horse');

    expect(stored.startsWith('scrypt$N=32768,r=8,p=1$')).toBe(true);
    expect(stored.split('$')).toHaveLength(4);
    expect(await verifyCredential('correct horse', stored)).toBe(true);
    expect(await verifyCredential('correct hors', stored)).toBe(false);
    expect(await verifyCredential('', stored)).toBe(false);
  });

  it('still verifies a hash written before the cost was recorded', async () => {
    /**
     * The whole point of accepting the old form: the pilot's operator and
     * machine credentials are already in databases in this shape, and refusing
     * them would lock every one of them out at the first sign-in.
     */
    const stored = legacy('shift-password');

    expect(stored.split('$')).toHaveLength(3);
    expect(await verifyCredential('shift-password', stored)).toBe(true);
    expect(await verifyCredential('shift-passwore', stored)).toBe(false);
  });

  it('answers false for anything malformed, and never throws', async () => {
    const good = await hashCredential('pw');
    const [, , salt, hash] = good.split('$');

    for (const stored of [
      null,
      '',
      'scrypt',
      'scrypt$',
      'not-scrypt$N=32768,r=8,p=1$aa$bb',
      // The cost field is not a cost field.
      `scrypt$N=32768,r=8$${salt}$${hash}`,
      `scrypt$rounds=4$${salt}$${hash}`,
      `scrypt$N=0,r=8,p=1$${salt}$${hash}`,
      // N must be a power of two: scrypt itself refuses anything else.
      `scrypt$N=32769,r=8,p=1$${salt}$${hash}`,
      // Bounded, because these numbers come out of a database row and go into
      // a memory allocation. 2^21 blocks is 2 GiB at r=8.
      `scrypt$N=2097152,r=8,p=1$${salt}$${hash}`,
      `scrypt$N=32768,r=64,p=1$${salt}$${hash}`,
      `scrypt$N=32768,r=8,p=99$${salt}$${hash}`,
      // A cost inside the bounds and past the memory guard: refused, not
      // allocated. N=2^20 at r=32 is 4 GiB of blocks.
      `scrypt$N=1048576,r=32,p=1$${salt}$${hash}`,
      // Five fields, and three-field forms that are not a hash.
      `scrypt$N=32768,r=8,p=1$${salt}$${hash}$extra`,
      `scrypt$${salt}$zzzz`,
      `scrypt$${salt}$`,
      // The right shape, a hash of the wrong length.
      `scrypt$N=32768,r=8,p=1$${salt}$aabb`,
    ]) {
      await expect(verifyCredential('pw', stored), JSON.stringify(stored)).resolves.toBe(false);
    }
  });

  it('does not produce the same hash twice for one secret', async () => {
    // The salt is what makes that true, and a fixed salt would make every
    // operator with the same shift password share a hash.
    expect(await hashCredential('pw')).not.toBe(await hashCredential('pw'));
  });
});
