import { execFile } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';

const run = promisify(execFile);
const SCRIPT = join(import.meta.dirname, '..', 'scripts', 'moov.ts');

/**
 * `moov.ts` is a gate, not a report: `docs/hardware-checkout.md` test 19 runs it
 * over a delivery and trusts the exit code. It used to print `NO MOOV` and
 * `unreadable` and still exit 0, so a truncated or half-written MP4 passed the
 * check that exists to catch it. These are the negative fixtures for that.
 */
const box = (type: string, payload = Buffer.alloc(0), declared?: number): Buffer => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(declared ?? 8 + payload.length, 0);
  head.write(type, 4, 'latin1');
  return Buffer.concat([head, payload]);
};

const ftyp = box('ftyp', Buffer.from('isom'));
const moov = box('moov', Buffer.alloc(24));
const mdat = box('mdat', Buffer.alloc(64));

/** Exit code plus stdout, without throwing on a non-zero exit. */
async function moovts(...args: string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout } = await run(process.execPath, [SCRIPT, ...args]);
    return { code: 0, out: stdout };
  } catch (err) {
    const e = err as { code?: number; stdout?: string };
    return { code: e.code ?? -1, out: e.stdout ?? '' };
  }
}

describe('the moov gate', () => {
  let dir: string;
  const file = (name: string): string => join(dir, name);

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'moov-'));
    await writeFile(file('front.mp4'), Buffer.concat([ftyp, moov, mdat]));
    await writeFile(file('back.mp4'), Buffer.concat([ftyp, mdat, moov]));
    await writeFile(file('nomoov.mp4'), Buffer.concat([ftyp, mdat]));
    await writeFile(file('nomdat.mp4'), Buffer.concat([ftyp, moov]));
    // moov at the front, then an mdat claiming 4096 bytes that are not there:
    // the shape both interrupted corpus sessions actually have.
    await writeFile(
      file('cut.mp4'),
      Buffer.concat([ftyp, moov, box('mdat', Buffer.alloc(64), 4096)]),
    );
  });

  it('passes a whole file whose moov leads', async () => {
    const { code, out } = await moovts(file('front.mp4'));
    expect(out).toContain('FRONT');
    expect(code).toBe(0);
  });

  it('fails a back-loaded moov', async () => {
    const { code, out } = await moovts(file('back.mp4'));
    expect(out).toContain('BACK');
    expect(code).toBe(1);
  });

  it('fails a file with no moov instead of only warning about it', async () => {
    const { code, out } = await moovts(file('nomoov.mp4'));
    expect(out).toContain('NO MOOV');
    expect(code).toBe(1);
  });

  it('fails a moov with no media behind it', async () => {
    const { code, out } = await moovts(file('nomdat.mp4'));
    expect(out).toContain('NO MDAT');
    expect(code).toBe(1);
  });

  it('fails a front-loaded moov whose boxes run past the end of the file', async () => {
    const { code, out } = await moovts(file('cut.mp4'));
    expect(out).toContain('DAMAGED');
    expect(code).toBe(1);
  });

  it('fails a file it cannot read at all', async () => {
    const { code, out } = await moovts(file('absent.mp4'));
    expect(out).toContain('unreadable');
    expect(code).toBe(1);
  });

  it('fails the whole run when one file of several is bad', async () => {
    const { code } = await moovts(file('front.mp4'), file('back.mp4'));
    expect(code).toBe(1);
  });

  it('asks for arguments rather than passing vacuously', async () => {
    const { code } = await moovts();
    expect(code).toBe(2);
  });
});
