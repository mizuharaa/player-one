/**
 * Who owns a keystroke on the review screen.
 *
 * A complete review has to be possible with no pointer — that is a throughput
 * requirement before it is an access one — so the shortcuts are bound to the
 * window rather than to the player, and every one of them is therefore a key
 * taken away from whatever has focus. Two rules decide when that is wrong, and
 * both were learned from the screen behaving badly:
 *
 * **A control that consumes typing keeps every key.** A text field takes
 * letters and digits because they are its content; a `<select>` takes them for
 * its own typeahead. A checkbox takes neither. That distinction is not
 * cosmetic: the reject reason list is checkboxes, and a blanket "any `<input>`"
 * guard meant the keyboard path ended exactly where a reject verdict has to go
 * — reach the reasons and `1`, `2` and `3` stop changing the verdict, `I` and
 * `O` stop marking.
 *
 * **Space and Enter belong to whatever has focus.** They are the platform's
 * activation keys. Without the exception, tabbing to "Mark in" and pressing
 * Space scrubbed the video instead of marking, and Enter on any focused control
 * committed the verdict as well as activating it — one keystroke, two effects,
 * one of them a payment.
 *
 * The two functions are split because only one of them needs a browser.
 * `focusKind` reads the DOM and is a straight mapping; `shortcutFires` is the
 * table above and is checked in `test/shortcuts.test.ts`.
 */

export type FocusKind =
  /** Takes letters and digits as content or typeahead: a text field, a select. */
  | 'typing'
  /** Takes only Space and Enter: a button, a link, a checkbox, a summary. */
  | 'activating'
  /** Nothing focused that wants keys at all. */
  | null;

export function shortcutFires(kind: FocusKind, key: string): boolean {
  if (kind === 'typing') return false;
  if (kind === 'activating') return key !== ' ' && key !== 'Enter';
  return true;
}

/**
 * `closest`, not a tag check on the target itself: a keystroke aimed at the
 * `<span>` inside a button arrives with that span as its target.
 */
export function focusKind(target: HTMLElement | null): FocusKind {
  const consuming = target?.closest('input, textarea, select');
  if (consuming) {
    const checkable =
      consuming instanceof HTMLInputElement &&
      (consuming.type === 'checkbox' || consuming.type === 'radio');
    return checkable ? 'activating' : 'typing';
  }
  if (target?.isContentEditable) return 'typing';
  return target?.closest('button, a[href], summary') ? 'activating' : null;
}
