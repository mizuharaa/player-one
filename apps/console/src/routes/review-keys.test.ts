/**
 * The review screen's keyboard, held in place by a test that cannot be
 * satisfied by a browser being unavailable.
 *
 * Reviewer throughput is the programme's ceiling and a complete review has to
 * be possible with no pointer at all, so the `switch (event.key)` in
 * `Review.tsx` is a contract rather than a convenience. A restyle is exactly
 * the kind of change that quietly loses a case — the button it was drawn next
 * to gets rebuilt and the branch goes with it — and nothing else in this repo
 * would notice.
 *
 * This reads the source rather than rendering the screen on purpose. Driving
 * the real component needs a claimed episode, a lease, a video element and a
 * mocked API, and a test that heavy is a test that gets skipped. What is being
 * protected here is the presence of the branches and of the one guard line,
 * both of which are visible in the text.
 *
 * The three things asserted:
 *
 * 1. **Every key still has a case.** The list below is the one in DESIGN.md and
 *    in the shortcut sheet.
 * 2. **Every key is still advertised** on the control it drives, through a
 *    `<Key>` cap — a reviewer learns the shortcut from the button they were
 *    already clicking, which is why the caps are not optional decoration.
 * 3. **The guide guard runs first.** `guideBlocksKeys(event)` is the first
 *    statement of the handler, before the text-field check and before the
 *    switch, so a tour dialog can never let Enter commit a verdict or let
 *    I/O/X move a mark. `guide.test.tsx` proves the signal itself; this proves
 *    that `Review.tsx` is the thing asking.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(import.meta.dirname, 'Review.tsx'), 'utf8');

/** Every case in the handler, and what it does. Losing one is a regression. */
const CASES: [key: string, does: string][] = [
  [' ', 'play / pause'],
  ['ArrowLeft', 'seek back, or a frame back with shift'],
  ['ArrowRight', 'seek forward, or a frame forward with shift'],
  ['j', 'slower'],
  ['J', 'slower'],
  ['l', 'faster'],
  ['L', 'faster'],
  ['i', 'mark in'],
  ['I', 'mark in'],
  ['o', 'mark out'],
  ['O', 'mark out'],
  ['x', 'clear the span at the playhead'],
  ['X', 'clear the span at the playhead'],
  ['1', 'verdict: good'],
  ['2', 'verdict: partial'],
  ['3', 'verdict: bad'],
  ['Enter', 'commit'],
  ['?', 'the shortcut sheet'],
  ['Escape', 'close the shortcut sheet'],
];

/** The caps drawn on the transport and the commit button. */
const CAPS = ['Space', 'I', 'O', 'X', '↵'];

/** The verdict pills pass their cap as a prop, so this is where 1 / 2 / 3 live. */
const VERDICT_CAPS = ['1', '2', '3'];

describe('the review screen keeps every keyboard path', () => {
  it('reads the screen it claims to', () => {
    expect(source).toContain('switch (event.key)');
    expect(source.length).toBeGreaterThan(10_000);
  });

  for (const [key, does] of CASES) {
    it(`still binds ${JSON.stringify(key)} — ${does}`, () => {
      expect(source).toContain(`case '${key}':`);
    });
  }

  it('advertises the shortcuts on the controls that use them', () => {
    for (const cap of CAPS) {
      expect(source, `<Key>${cap}</Key> is how a reviewer learns it`).toContain(`>${cap}</Key>`);
    }
    for (const cap of VERDICT_CAPS) {
      expect(source, `the verdict pill for ${cap} must still carry its cap`).toContain(
        `shortcut="${cap}"`,
      );
    }
    expect(source, 'the pill renders the cap it was given').toContain('<Key>{shortcut}</Key>');
  });

  it('keeps the three verdict glyphs beside the three verdict colours', () => {
    for (const glyph of ['IconPass', 'IconPartial', 'IconReject']) {
      expect(source).toContain(glyph);
    }
    for (const hue of ['var(--pass)', 'var(--partial)', 'var(--reject)']) {
      expect(source).toContain(hue);
    }
  });

  it('keeps the sentence that says the figure is not the payment', () => {
    expect(source).toContain("t('mark.estimateHint')");
  });
});

describe('a tour cannot reach the review keyboard', () => {
  it('asks the guide before anything else in the handler', () => {
    expect(source).toContain(
      "import { guideBlocksKeys } from '../components/guide/useGuide.ts';",
    );

    const handler = source.slice(source.indexOf('const onKey = (event: KeyboardEvent) => {'));
    const guard = handler.indexOf('if (guideBlocksKeys(event)) return;');
    expect(guard, 'the handler must call guideBlocksKeys').toBeGreaterThan(-1);

    /** Before the text-field check, and before the switch: nothing runs first. */
    expect(guard).toBeLessThan(handler.indexOf('switch (event.key)'));
    expect(guard).toBeLessThan(handler.indexOf('event.target'));
  });
});

describe('nothing cartoon stands next to footage', () => {
  it('mounts no mascot on this screen', () => {
    for (const forbidden of ['Panda', 'PandaStage', 'EmptyState', 'Cu']) {
      expect(source, `${forbidden} must not reach the review screen`).not.toContain(
        `${forbidden}`,
      );
    }
  });
});
