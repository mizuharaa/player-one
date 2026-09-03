import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';

/**
 * The corpus tests skip when the sessions are absent, which is right on a fresh
 * clone and wrong on a machine that claims to have run acceptance 10.3.9: a
 * two-session copy once produced a green run. `PLAYERONE_REQUIRE_CORPUS=1` is
 * the fail-closed switch, and this is the test that it actually fails.
 */
function fakeCorpus(ids: readonly string[]): string {
  const root = mkdtempSync(join(tmpdir(), 'px-corpus-'));
  for (const id of ids) {
    const dir = join(root, `ego_AZER76400FE_20260813_${id}`);
    mkdirSync(dir);
    writeFileSync(join(dir, `ego_AZER76400FE_20260813_${id}_camera_left_part0001.mp4`), 'not really video');
  }
  return root;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

it('PLAYERONE_REQUIRE_CORPUS=1 refuses a short corpus, and says how short', async () => {
  vi.stubEnv('PLAYERONE_SESSIONS', fakeCorpus(['072310', '072415']));
  vi.stubEnv('PLAYERONE_REQUIRE_CORPUS', '1');
  vi.resetModules();

  await expect(import('./sessions.ts')).rejects.toThrow(/2 of 5 sample sessions have media \(2 directories\)/);
});

it('PLAYERONE_REQUIRE_CORPUS=1 refuses five sessions with no media', async () => {
  const root = fakeCorpus([]);
  for (const id of ['072310', '072415', '072516', '072538', '073055']) {
    mkdirSync(join(root, `ego_AZER76400FE_20260813_${id}`));
  }
  vi.stubEnv('PLAYERONE_SESSIONS', root);
  vi.stubEnv('PLAYERONE_REQUIRE_CORPUS', '1');
  vi.resetModules();

  await expect(import('./sessions.ts')).rejects.toThrow(/0 of 5 sample sessions have media \(5 directories\)/);
});

it('without the switch the same short corpus only skips', async () => {
  vi.stubEnv('PLAYERONE_SESSIONS', fakeCorpus(['072310', '072415']));
  vi.stubEnv('PLAYERONE_REQUIRE_CORPUS', undefined);
  vi.resetModules();

  const { hasSession } = await import('./sessions.ts');
  expect(hasSession('072310')).toBe(true);
  expect(hasSession('073055')).toBe(false);
});
