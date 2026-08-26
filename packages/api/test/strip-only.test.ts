import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * `bin/serve.ts` and `bin/payout-worker.ts` run their .ts directly under
 * Node's strip-only type stripping, which refuses TypeScript syntax that has
 * runtime meaning — parameter properties above all. Vitest transpiles through
 * esbuild, which accepts them, so a suite can be green while the server no
 * longer starts. This is the one test that loads the API the way `bin/` does.
 *
 * Found the hard way on 2026-08-26: two classes in the payout domain stopped
 * serve.ts at import time while 726 tests passed.
 */
describe('the API loads under node strip-only mode, as bin/ runs it', () => {
  it('imports src/index.ts with plain node', () => {
    const entry = join(import.meta.dirname, '..', 'src', 'index.ts');
    const url = `file:///${entry.replaceAll('\', '/')}`;
    const run = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`],
      { encoding: 'utf8', timeout: 60_000 },
    );
    expect(run.status, `${run.stderr}\n${run.stdout}`).toBe(0);
    expect(run.stderr).not.toMatch(/ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX|SyntaxError/);
  });
});
