import { describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { cp, mkdtemp, readdir, rm, stat } from 'node:fs/promises';

/**
 * The CLI's side of the store, and the guarantees that hold with no database
 * anywhere. Nothing here needs Postgres: that is the point of every test in
 * this file. The engine runs at upload centres with the link down.
 */

const run = promisify(execFile);
const BIN = join(import.meta.dirname, '..', 'bin', 'ingest.ts');
const FIXTURES = join(import.meta.dirname, '..', '..', '..', 'fixtures', 'sessions');
const STEM = 'ego_SYNTH0000001_20260813_090800';

async function ingestCli(args: string[], env: Record<string, string> = {}) {
  const cache = await mkdtemp(join(tmpdir(), 'px-cache-'));
  try {
    const { stdout, stderr } = await run('node', [BIN, ...args], {
      env: { ...process.env, DATABASE_URL: '', PLAYERONE_CACHE: cache, ...env },
      maxBuffer: 32 * 1024 * 1024,
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  } finally {
    await rm(cache, { recursive: true, force: true });
  }
}

async function copyOf(label: string) {
  const root = await mkdtemp(join(tmpdir(), 'px-cli-'));
  const dir = join(root, STEM);
  const [only] = await readdir(join(FIXTURES, label));
  await cp(join(FIXTURES, label, only!), dir, { recursive: true });
  return { root, dir, cleanup: () => rm(root, { recursive: true, force: true }) };
}

describe('with no --store and no DATABASE_URL, nothing has changed', () => {
  it('never opens a connection and exits as it always did', async () => {
    const c = await copyOf('delivery-a');
    const r = await ingestCli([c.dir, '--json']);
    expect(r.code).toBe(0);
    const record = JSON.parse(r.stdout);
    expect(record.schema_version).toBe('1.1.0');
    expect(record.state).toBe('flagged');
    expect(r.stderr).toBe('');
    await c.cleanup();
  });

  it('a quarantined session still exits 1', async () => {
    const c = await copyOf('no-calibration');
    const r = await ingestCli([c.dir]);
    expect(r.code).toBe(1);
    await c.cleanup();
  });
});

describe('--store when the database cannot be reached', () => {
  /**
   * The measurement is the expensive part of the run. Losing it because
   * Postgres was down would mean re-hashing every byte of a 32 GB session, so
   * the record is printed first and the failure is reported after it — loudly,
   * and never as though the store had succeeded.
   */
  it('prints the record anyway, then fails with a clear error that hides the password', async () => {
    const c = await copyOf('delivery-a');
    // Port 1 is reserved and nothing listens on it.
    const r = await ingestCli([c.dir, '--json', '--store'], {
      DATABASE_URL: 'postgres://someone:hunter2@127.0.0.1:1/nothing',
    });

    expect(r.code).not.toBe(0);
    const record = JSON.parse(r.stdout); // the record survived
    expect(record.content_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(r.stderr).toContain('store failed');
    expect(r.stderr).not.toContain('stored:');
    // A connection string carries a password and error output gets pasted around.
    expect(r.stderr).not.toContain('hunter2');
    expect(r.stderr).toContain('***');
    await c.cleanup();
  });

  it('says so plainly when DATABASE_URL is not set, and leaves the card alone (ING-34)', async () => {
    const c = await copyOf('delivery-a');
    const snapshot = async () =>
      Promise.all(
        (await readdir(c.dir)).sort().map(async (n) => {
          const st = await stat(join(c.dir, n));
          return `${n}|${st.size}|${st.mtimeMs}`;
        }),
      );
    const before = await snapshot();

    const r = await ingestCli([c.dir, '--store']);
    expect(r.code).not.toBe(0);
    expect(r.stderr).toContain('DATABASE_URL is not set');
    expect(r.stdout).toContain('fingerprint'); // still printed the summary
    // The TF card is evidence in a payment dispute. Not a lock file, not a marker.
    expect(await snapshot()).toEqual(before);

    await c.cleanup();
  });
});

describe('--store does not change the record', () => {
  it('the JSON is byte-identical with and without the flag, apart from the run fields', async () => {
    const c = await copyOf('delivery-a');
    const plain = JSON.parse((await ingestCli([c.dir, '--json'])).stdout);
    const stored = JSON.parse(
      (
        await ingestCli([c.dir, '--json', '--store'], {
          DATABASE_URL: 'postgres://nobody:nobody@127.0.0.1:1/nothing',
        })
      ).stdout,
    );
    const strip = (r: Record<string, unknown>) =>
      JSON.stringify({ ...r, source: { ...(r['source'] as object), ingested_at: '', ingest_host: '' } });
    expect(strip(stored)).toBe(strip(plain));
    await c.cleanup();
  });
});
