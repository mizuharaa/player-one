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

/**
 * The seed and the demo cannot want the same billing period.
 *
 * At the rehearsal the 0:24 bill request for the demo period answered
 * `created: 0` with `deferred_to_next_period: {settlements: 2}`, because the
 * seeded bill already held that exact period and
 * `bills_collector_period_key` has nowhere to put a second one. The room
 * watched a review become money and then saw no bill.
 *
 * Read as text for the same reason the scenario check above is: both scripts
 * open a database at module scope, so importing one runs it.
 */
describe('the period the seeded bill owns, against the one the demo asks for', () => {
  const period = (file: string, name: string): { start: Date; end: Date } => {
    const text = source('packages', 'api', 'scripts', file);
    const found = new RegExp(
      `const ${name} = \\{ start: '([^']+)', end: '([^']+)' \\};`,
    ).exec(text);
    expect(found, `${file} still declares ${name} as one object literal`).not.toBeNull();
    // A zone on both, because `'2026-09-01'::timestamptz` is midnight in
    // whatever TimeZone the session carries and this seed runs in two of them.
    expect(found![1], `${name}.start carries an explicit zone`).toMatch(/Z$/);
    expect(found![2], `${name}.end carries an explicit zone`).toMatch(/Z$/);
    return { start: new Date(found![1]!), end: new Date(found![2]!) };
  };

  const seeded = period('seed-demo-work.mjs', 'BILL_PERIOD');
  const demo = period('seed-stakeholder.mjs', 'DEMO_BILL_PERIOD');

  it('seeds a bill that closes before the demo day', () => {
    expect(seeded.start.toISOString()).toBe('2026-09-01T00:00:00.000Z');
    expect(seeded.end.toISOString()).toBe('2026-09-14T00:00:00.000Z');
  });

  it('prints a period that does not collide with the seeded one', () => {
    // Identical on either bound is enough to make it a different row; the test
    // is on the pair, because that is what the unique index is on.
    expect(
      seeded.start.getTime() !== demo.start.getTime() ||
        seeded.end.getTime() !== demo.end.getTime(),
    ).toBe(true);
    // And it starts after the seeded cycle closed, so the collector's "This
    // cycle" label is not a period they were already paid for.
    expect(demo.start.getTime()).toBeGreaterThanOrEqual(seeded.end.getTime());
    expect(demo.end.getTime()).toBeGreaterThan(demo.start.getTime());
  });

  /**
   * `settleable()` in settle.ts bounds the cycle with `settlements.created_at <
   * period_end` and has no lower bound, so an end on the demo day's own
   * midnight excludes everything reviewed that day — which is all of the money
   * 0:24 exists to bill.
   */
  it('ends after the demo day, not on it', () => {
    const thursday = new Date('2026-09-17T00:00:00Z');
    expect(demo.end.getTime()).toBeGreaterThan(thursday.getTime());
  });

  it('is printed as the body an operator can paste', () => {
    const script = source('packages', 'api', 'scripts', 'seed-stakeholder.mjs');
    // Both bounds, from the constant rather than retyped into the message.
    expect(script).toMatch(/period_start[\s\S]{0,40}DEMO_BILL_PERIOD\.start/);
    expect(script).toMatch(/period_end[\s\S]{0,40}DEMO_BILL_PERIOD\.end/);
    // And the seeded period is read back from the row it wrote, never restated
    // here — a second copy is the thing that drifted in the first place.
    expect(script).toContain('select period_start, period_end from bills');
    expect(script).not.toContain('2026-09-01');
  });

  it('is the period the runbook tells the host to paste', () => {
    // The runbook's date is a hand edit; this is what drifted to 09-16 once.
    const runbook = source('deploy', 'DEMO-RUNBOOK.md');
    const day = (d: Date) => d.toISOString().slice(0, 10);
    expect(runbook).toContain(`"period_start":"${day(demo.start)}","period_end":"${day(demo.end)}"`);
  });
});

/**
 * cloud.env ships PLAYERONE_DEMO_ZALO_ID with an empty value, and `up.sh` runs
 * this seed. Reading '' as a wrong id rather than as no id took the whole live
 * deployment down on 2026-09-16: the seed refused, `up` failed with it, and the
 * API never came back until the stack was brought up again.
 */
it('reads an empty PLAYERONE_DEMO_ZALO_ID as no id at all', () => {
  const script = source('packages', 'api', 'scripts', 'seed-demo.mjs');
  // The empty check comes before the digits check, so '' can never reach it.
  const empty = script.indexOf("configuredZaloId === ''");
  const digits = script.indexOf('/^[0-9]{6,32}$/');
  expect(empty, 'the empty-string check exists').toBeGreaterThan(-1);
  expect(digits, 'the digits check exists').toBeGreaterThan(-1);
  expect(empty).toBeLessThan(digits);
});
