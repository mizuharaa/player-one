import { existsSync, readdirSync, statSync } from 'node:fs';
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

/** The five sessions acceptance 10.3.9 names. */
const REQUIRED = ['072310', '072415', '072516', '072538', '073055'] as const;

/**
 * Skipping is the right default — a fresh clone has no corpus — but it made a
 * degraded corpus indistinguishable from a green run: a two-session copy once
 * passed. `PLAYERONE_REQUIRE_CORPUS=1` turns the skip into a failure. Media is
 * checked by a non-empty `.mp4` in each session directory, which is the cheapest
 * thing that separates the real archive from a directory tree of names.
 */
if (process.env['PLAYERONE_REQUIRE_CORPUS'] === '1') {
  const dirs = existsSync(SESSIONS_ROOT)
    ? readdirSync(SESSIONS_ROOT, { withFileTypes: true }).filter((e) => e.isDirectory())
    : [];
  const withMedia = REQUIRED.filter((id) => {
    const dir = join(SESSIONS_ROOT, `ego_AZER76400FE_20260813_${id}`);
    // ponytail: a size check, not a decode; ffprobe here if a truncated MP4 ever slips through.
    return existsSync(dir) && readdirSync(dir).some((n) => n.endsWith('.mp4') && statSync(join(dir, n)).size > 0);
  });
  if (dirs.length !== REQUIRED.length || withMedia.length !== REQUIRED.length) {
    throw new Error(
      `PLAYERONE_REQUIRE_CORPUS=1: ${withMedia.length} of ${REQUIRED.length} sample sessions have media ` +
        `(${dirs.length} ${dirs.length === 1 ? 'directory' : 'directories'}) under ${SESSIONS_ROOT}. ` +
        `Missing: ${REQUIRED.filter((id) => !withMedia.includes(id)).join(', ') || 'none'}. ` +
        'Point PLAYERONE_SESSIONS at the full corpus or unset PLAYERONE_REQUIRE_CORPUS to skip.',
    );
  }
}

export const session = (id: string): string =>
  join(SESSIONS_ROOT, `ego_AZER76400FE_20260813_${id}`);

export const hasSession = (id: string): boolean => existsSync(session(id));

/** A checkout of huggingface.co/datasets/paxini/Omnisharing_DB_SampleData. LFS payloads not needed. */
export const PAXINI_ROOT = process.env['PAXINI_SAMPLE'] ?? '';
export const hasPaxini = (): boolean => PAXINI_ROOT !== '' && existsSync(PAXINI_ROOT);
