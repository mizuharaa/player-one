import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The five real sample sessions. Not committed — hundreds of MB of MP4 — so the
 * tests that need them skip when they are absent, and `pnpm test` passes on a
 * fresh clone with nothing installed but node_modules.
 *
 * Default location is `docs/sample_data/` inside the repo, which `.gitignore`
 * excludes: drop the extracted archive there and the real-session tests run
 * with no environment variable at all. `PLAYERONE_SESSIONS` overrides it.
 *
 * The directory pointed at must be the one *containing* the
 * `ego_AZER76400FE_20260813_*` folders, whatever the archive wrapped them in.
 */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..');

/** The archive from Alois arrives with a timestamped wrapper directory. */
function findCorpus(): string {
  const base = join(REPO_ROOT, 'docs', 'sample_data');
  const direct = join(base, 'EgoCamera Sample Data');
  if (existsSync(direct)) return direct;
  // One level of wrapper, e.g. "EgoCamera Sample Data-20260821T084636Z-1-001".
  try {
    for (const entry of readdirSync(base)) {
      const nested = join(base, entry, 'EgoCamera Sample Data');
      if (existsSync(nested)) return nested;
    }
  } catch {
    // No docs/sample_data at all, which is the normal state of a fresh clone.
  }
  return direct;
}

export const SESSIONS_ROOT = process.env['PLAYERONE_SESSIONS'] ?? findCorpus();

export const session = (id: string): string =>
  join(SESSIONS_ROOT, `ego_AZER76400FE_20260813_${id}`);

export const hasSession = (id: string): boolean => existsSync(session(id));

/** A checkout of huggingface.co/datasets/paxini/Omnisharing_DB_SampleData. LFS payloads not needed. */
export const PAXINI_ROOT = process.env['PAXINI_SAMPLE'] ?? '';
export const hasPaxini = (): boolean => PAXINI_ROOT !== '' && existsSync(PAXINI_ROOT);
