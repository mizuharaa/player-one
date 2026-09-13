import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The demo seed and the app have to agree on scenario codes.
 *
 * `seed-demo.mjs` created scenario code `demo-home`; `SCENARIOS` in
 * `apps/collector/src/api/types.ts` is `home | office | shop | warehouse` and
 * `asScenario` in `api/http.ts` throws `unsupported_scenario` on anything else,
 * while the server refuses `scenario_not_found` for a code with no row. So a
 * seeded demo database had no session the app could create and none it could
 * list. Nothing in either file pointed at the other, and both were internally
 * consistent — which is why this reads the two sources and compares them.
 *
 * ponytail: the two sources are read as TEXT, not imported. The seed opens a
 * database at module scope, so importing it would run it; the app's types file
 * is compiled under the collector's own tsconfig, and pulling it into this
 * package's graph drags React Native's types along with it. Two regexes with
 * their own "did this actually match anything" assertions is the whole cost.
 */
const root = join(import.meta.dirname, '..', '..', '..');
const source = (...parts: string[]) => readFileSync(join(root, ...parts), 'utf8');

describe('the demo seed against the app it seeds for', () => {
  it('creates only scenario codes the app accepts', () => {
    const app = source('apps', 'collector', 'src', 'api', 'types.ts');
    const list = /export const SCENARIOS = \[([^\]]+)\] as const;/.exec(app);
    expect(list, 'SCENARIOS is still declared as one array literal in types.ts').not.toBeNull();
    const accepted = [...list![1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
    expect(accepted).toContain('home');

    const seed = source('packages', 'api', 'scripts', 'seed-demo.mjs');
    const seeded = [...seed.matchAll(/SCENARIO_CODE = '([^']*)'/g)].map((m) => m[1]!);
    expect(seeded.length, 'seed-demo.mjs still names its scenario codes as literals').toBeGreaterThan(0);

    for (const code of seeded) {
      expect(accepted, `seed-demo.mjs seeds scenario code ${JSON.stringify(code)}`).toContain(code);
    }
  });
});
