// @vitest-environment jsdom
/**
 * The one thing about the tour that is not cosmetic.
 *
 * `/review` binds Space, ←, →, J, L, I, O, X, 1, 2, 3 and Enter to `window`,
 * because a complete review has to be possible with no pointer. Enter commits a
 * verdict, which pays somebody. The tour is driven with Enter and the arrow
 * keys. Without a guard, reading the tour would seek the video, move a mark and
 * — on the last step, where Enter means "Done" — commit a verdict nobody chose.
 *
 * There are two halves to the guard and this file measures both:
 *
 * 1. **The live signal.** `guideBlocksKeys` answers `true` from the moment
 *    `startGuide` is called, before any dialog exists, and `false` again the
 *    moment it closes. It is a module variable and not React state, because a
 *    React state update is not visible to a native listener running in the same
 *    tick as the key it is judging.
 * 2. **The stopped event.** Every key event is stopped at the dialog element in
 *    the bubble phase, so it never reaches `window` at all — including the key
 *    that closes the tour, which is the case a `stopPropagation` written in
 *    React would miss, because React delegates to the root container and the
 *    native event carries on regardless.
 *
 * The window listener below is the review screen's, reduced to the part that
 * matters: it records every key it was allowed to see. Nothing in this file
 * mocks the guide.
 */
import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import '../../lib/i18n.ts';
import { Guide } from './Guide.tsx';
import { guideBlocksKeys, isGuideOpen, startGuide, stopGuide } from './useGuide.ts';
import { GUIDE_STEPS } from './steps.ts';

/**
 * jsdom 30 still ships `<dialog>` without `showModal`, `close` or the top
 * layer. The three lines below are the minimum that lets the component under
 * test run: they set and clear the `open` property the same way the platform
 * does. Nothing this file asserts depends on them — the guarantee being
 * measured is that a `keydown` handler bound to the dialog element stops the
 * event before `window` sees it, and event propagation is jsdom's own, not
 * this shim's.
 */
if (typeof HTMLDialogElement !== 'undefined' && !HTMLDialogElement.prototype.showModal) {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new window.Event('close'));
  };
}

declare global {
  // eslint-disable-next-line no-var
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** The review screen's handler, with the one line the guide asks it to add. */
function reviewListener(seen: string[]) {
  return (event: KeyboardEvent) => {
    if (guideBlocksKeys(event)) return;
    seen.push(event.key);
  };
}

let container: HTMLDivElement;
let root: Root;
let seen: string[];
let listener: (event: KeyboardEvent) => void;

function press(target: EventTarget, key: string) {
  act(() => {
    target.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

function dialogNode(): HTMLDialogElement {
  const node = container.querySelector('dialog');
  expect(node, 'the guide renders a real <dialog>').not.toBeNull();
  return node as HTMLDialogElement;
}

beforeEach(() => {
  seen = [];
  listener = reviewListener(seen);
  window.addEventListener('keydown', listener);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <StrictMode>
        <Guide pathname="/" />
      </StrictMode>,
    );
  });
});

afterEach(() => {
  window.removeEventListener('keydown', listener);
  act(() => root.unmount());
  container.remove();
  stopGuide();
});

describe('the review screen keeps its keys while no tour is open', () => {
  it('a key reaches the window listener', () => {
    press(window, 'Enter');
    press(window, 'I');
    expect(seen).toEqual(['Enter', 'I']);
    expect(isGuideOpen()).toBe(false);
  });
});

describe('a tour blocks the review screen entirely', () => {
  it('raises the signal synchronously, before any dialog opens', () => {
    expect(isGuideOpen()).toBe(false);
    act(() => {
      startGuide('/review');
      /*
       * Still inside the act callback, so React has not committed anything:
       * no dialog exists yet and the flag is already up. That ordering is the
       * assertion — a signal raised after the dialog opens leaves one tick in
       * which the review screen still believes its shortcuts are live.
       */
      expect(isGuideOpen()).toBe(true);
      expect(guideBlocksKeys(new window.KeyboardEvent('keydown', { key: 'Enter' }))).toBe(true);
      expect(container.querySelector('dialog')?.open ?? false).toBe(false);
    });
  });

  it('lets no key through to the window, from inside the dialog or from the window itself', () => {
    act(() => {
      startGuide('/');
    });
    const node = dialogNode();
    expect(node.open, 'showModal ran').toBe(true);
    expect(document.documentElement.hasAttribute('data-guide-open')).toBe(true);

    /* The verdict and marking keys, pressed inside the tour. */
    for (const key of [' ', 'ArrowLeft', 'ArrowRight', 'I', 'O', 'X', '1', '2', '3']) {
      press(node, key);
    }
    /* And a key that never reaches the dialog at all — the guard's other half. */
    press(window, 'Enter');

    expect(seen, 'nothing reached the review screen').toEqual([]);
  });

  it('does not leak the Enter that closes it', () => {
    const steps = GUIDE_STEPS['/'] ?? [];
    expect(steps.length).toBeGreaterThan(1);
    act(() => {
      startGuide('/');
    });
    const node = dialogNode();

    /* Enter through every step. The last one is "Done" and closes the tour. */
    for (let i = 0; i < steps.length; i += 1) press(node, 'Enter');

    expect(isGuideOpen(), 'the tour closed').toBe(false);
    expect(seen, 'the closing Enter did not commit a verdict').toEqual([]);
    expect(document.documentElement.hasAttribute('data-guide-open')).toBe(false);
  });

  it('does not leak the Escape that dismisses it', () => {
    act(() => {
      startGuide('/');
    });
    press(dialogNode(), 'Escape');
    expect(isGuideOpen()).toBe(false);
    expect(seen).toEqual([]);
  });
});

describe('the shortcuts come back', () => {
  it('after the tour closes, a key reaches the window listener again', () => {
    act(() => {
      startGuide('/');
    });
    press(dialogNode(), 'Escape');
    press(window, 'Enter');
    press(window, '1');
    expect(seen).toEqual(['Enter', '1']);
  });

  it('a route change ends the tour, so the signal cannot outlive the screen', () => {
    act(() => {
      startGuide('/');
    });
    expect(isGuideOpen()).toBe(true);
    act(() => {
      root.render(
        <StrictMode>
          <Guide pathname="/review" />
        </StrictMode>,
      );
    });
    expect(isGuideOpen()).toBe(false);
    press(window, 'Enter');
    expect(seen).toEqual(['Enter']);
  });

  it('an unmount ends it too', () => {
    act(() => {
      startGuide('/');
    });
    act(() => root.unmount());
    expect(isGuideOpen()).toBe(false);
    press(window, 'Enter');
    expect(seen).toEqual(['Enter']);
    /* `afterEach` unmounts again; React tolerates that and the guard is idempotent. */
    root = createRoot(container);
  });
});
