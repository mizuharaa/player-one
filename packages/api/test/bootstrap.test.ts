import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { open } from '@playerone/store';
import { main, parseBootstrapArgs } from '../bin/bootstrap.ts';

vi.mock('@playerone/store', async (importOriginal) => ({
  ...await importOriginal<typeof import('@playerone/store')>(),
  open: vi.fn().mockRejectedValue(new Error('driver included secret-and-hash')),
}));

const create = [
  '--centre-region', 'HCM', '--centre-name', 'Upload centre HCM-01',
  '--machine', 'counter-1', '--machine-secret', 'machine-private',
  '--operator', 'op-1:administrator:operator-private',
];
const env = { DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused' };
const without = (flag: string) => {
  const args = [...create];
  args.splice(args.indexOf(flag), 2);
  return args;
};

describe('bootstrap arguments (no database)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it.each(['centre-region', 'centre-name', 'machine', 'machine-secret', 'operator'])(
    'missing --%s exits 2 naming the flag before opening a database', async (flag) => {
      expect(await main(without(`--${flag}`), env)).toBe(2);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`--${flag}`));
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('requires DATABASE_URL before opening a database', async () => {
    expect(await main(create, {})).toBe(2);
    expect(console.error).toHaveBeenCalledWith('bootstrap: DATABASE_URL is required');
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['administrator', 'finance', 'centre_operator'])('parses the %s triple', (role) => {
    const options = parseBootstrapArgs([...without('--operator'), '--operator', `ref:${role}:secret:with:colons`]);
    expect(options).toMatchObject({ mode: 'create', operators: [{ ref: 'ref', role, secret: 'secret:with:colons' }] });
  });

  it('keeps repeatable operators in the supplied order', () => {
    expect(parseBootstrapArgs([...create, '--operator', 'fin-1:finance:finance-private']))
      .toMatchObject({ operators: [{ ref: 'op-1' }, { ref: 'fin-1' }] });
  });

  it.each(['ref', 'ref:administrator', ':administrator:private', 'ref::private', 'ref:administrator:'])(
    'refuses malformed triple %s without echoing credentials', async (triple) => {
      expect(await main([...without('--operator'), '--operator', triple], env)).toBe(2);
      expect(console.error).toHaveBeenCalledWith('bootstrap: --operator requires ref:role:secret');
      expect(open).not.toHaveBeenCalled();
    },
  );

  it.each(['reviewer', 'admin', 'Finance', 'super_administrator', 'unknown'])(
    'refuses role %s before any database call', async (role) => {
      expect(await main([...create, '--operator', `bad:${role}:never-print-me`], env)).toBe(2);
      expect(console.error).toHaveBeenCalledWith(`bootstrap: unsupported operator role '${role}'`);
      expect(open).not.toHaveBeenCalled();
    },
  );

  it.each(['centre-region', 'centre-name', 'machine', 'operator'])(
    'refuses --%s with either rotation kind', async (flag) => {
      for (const kind of ['machine', 'operator']) {
        expect(await main([`--rotate-${kind}`, 'ref', `--${kind}-secret`, 'private', `--${flag}`, 'create-value'], env)).toBe(2);
        expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`--${flag}`));
      }
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('refuses both rotate flags together', async () => {
    expect(await main(['--rotate-machine', 'same', '--rotate-operator', 'same', '--machine-secret', 'private'], env)).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--rotate-machine and --rotate-operator'));
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['machine', 'operator'])('parses --rotate-%s', (kind) => {
    expect(parseBootstrapArgs([`--rotate-${kind}`, 'same', `--${kind}-secret`, 'private']))
      .toEqual({ mode: `rotate-${kind}`, ref: 'same', secret: 'private' });
  });

  it.each(['machine', 'operator'])('requires the --%s-secret for rotation', async (kind) => {
    expect(await main([`--rotate-${kind}`, 'ref'], env)).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining(`--${kind}-secret`));
    expect(open).not.toHaveBeenCalled();
  });

  it.each(['machine', 'operator'])('rejects the other secret flag on --rotate-%s', async (kind) => {
    const other = kind === 'machine' ? 'operator' : 'machine';
    expect(await main([`--rotate-${kind}`, 'ref', `--${kind}-secret`, 'private', `--${other}-secret`, 'wrong'], env)).toBe(2);
    expect(open).not.toHaveBeenCalled();
  });

  it('refuses --operator-secret in create mode', async () => {
    expect(await main([...create, '--operator-secret', 'private'], env)).toBe(2);
    expect(open).not.toHaveBeenCalled();
  });

  it('names a flag missing its value', async () => {
    expect(await main([...create, '--rotate-machine'], env)).toBe(2);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining('--rotate-machine'));
    expect(open).not.toHaveBeenCalled();
  });

  it.each([['--unknown=never-print-me'], ['never-print-me']])('does not echo unexpected arguments %j', async (extra) => {
    expect(await main([...create, ...extra], env)).toBe(2);
    expect(console.error).toHaveBeenCalledWith('bootstrap: invalid arguments');
    expect(open).not.toHaveBeenCalled();
  });

  it('does not expose database error details', async () => {
    expect(await main(create, env)).toBe(1);
    expect(console.error).toHaveBeenCalledWith('bootstrap: database operation failed; check database availability and constraints');
    expect(console.log).not.toHaveBeenCalled();
  });

  it('the real CLI exits 2 without a database or credentials in its output', () => {
    const childEnv = { ...process.env };
    delete childEnv['DATABASE_URL'];
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../bin/bootstrap.ts', import.meta.url)), ...create],
      { env: childEnv, encoding: 'utf8', timeout: 15_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('DATABASE_URL is required');
    expect(result.stderr).not.toMatch(/machine-private|operator-private|scrypt\$/);
  });
});
