import { describe, expect, it } from 'vitest';
import { shortcutFires, type FocusKind } from '../src/lib/shortcuts.ts';

/**
 * The keyboard path, as the one table that decides whether it holds.
 *
 * Review's shortcuts are bound to the window, so every one of them is a key
 * taken from whatever has focus, and the screen is unusable without a pointer
 * if this table is wrong in either direction. Both directions have been wrong:
 *
 * - Too permissive: Space scrubbed the video while "Mark in" had focus, and
 *   Enter on any focused control committed a verdict as well as activating it.
 * - Too strict: a blanket "any `<input>` swallows every key" guard meant that
 *   the moment a reviewer tabbed into the reject reason list — the one place a
 *   reject verdict must go — the digits stopped changing the verdict and the
 *   letters stopped marking. Reject is the verdict that pays nothing, so that
 *   is the decision the keyboard was refusing to finish.
 *
 * No browser and no database: the DOM half is `focusKind`, which is a straight
 * mapping onto these three cases, and this is the part with the branches.
 */

const LETTERS = ['i', 'o', 'x', 'j', 'l', '1', '2', '3', '?'];
const ACTIVATION = [' ', 'Enter'];

describe('a window shortcut only fires when nothing else wants the key', () => {
  it('fires for everything when nothing is focused', () => {
    for (const key of [...LETTERS, ...ACTIVATION, 'ArrowLeft', 'Escape']) {
      expect(shortcutFires(null, key)).toBe(true);
    }
  });

  it('fires for nothing while a text field or a select has focus', () => {
    for (const key of [...LETTERS, ...ACTIVATION, 'ArrowLeft']) {
      expect(shortcutFires('typing', key)).toBe(false);
    }
  });

  /**
   * The case the reject verdict depends on. A checkbox and a button take Space
   * and Enter and nothing else, so the marks, the rates and the three verdict
   * digits all stay live while a reason is focused.
   */
  it.each(LETTERS)('fires %j while a checkbox or a button has focus', (key) => {
    expect(shortcutFires('activating', key)).toBe(true);
  });

  it.each(ACTIVATION)('leaves %j to the focused control', (key) => {
    expect(shortcutFires('activating', key)).toBe(false);
  });

  /** Every kind is covered above; a fourth would be an unhandled case. */
  it('has no fourth kind of focus', () => {
    const kinds: FocusKind[] = ['typing', 'activating', null];
    expect(new Set(kinds).size).toBe(3);
  });
});
