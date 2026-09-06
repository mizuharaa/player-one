/**
 * The tour's state, and the one thing the review screen needs to know about it.
 *
 * This module is deliberately tiny and imports no component. `Review.tsx` calls
 * `guideBlocksKeys` at the top of its window key handler, and if that function
 * lived beside the dialog then three.js, the panda and the spotlight overlay
 * would all be in the review route's bundle — which is the one bundle the
 * mascot is banned from.
 *
 * **Why the review screen has to ask at all.** `/review` binds Space, ←, →, J,
 * L, I, O, X, 1, 2, 3 and Enter to the window, because a complete review has to
 * be possible with no pointer. Enter commits a verdict and pays somebody. A
 * tour with a "Next" button is driven with Enter and the arrow keys, so without
 * this the act of reading the tour would seek the video, move a mark and, on
 * the last step, commit.
 *
 * **The lifecycle is the guarantee, not the flag.** The signal is set
 * synchronously in `startGuide`, *before* any dialog opens, held for the whole
 * life of the dialog, and cleared in `stopGuide` — which is called on close, on
 * unmount and on a route change. It is not derived from React state, because a
 * React state update is not visible to a native listener that runs in the same
 * tick. The dialog additionally stops key events natively at its own element,
 * so the Enter or Escape that *closes* the tour never reaches the window either.
 * Both halves are proved in `guide.test.tsx`.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { stepsFor, type GuideStep } from './steps.ts';

type GuideState = {
  open: boolean;
  index: number;
  steps: GuideStep[];
};

const CLOSED: GuideState = { open: false, index: 0, steps: [] };

let state: GuideState = CLOSED;
const listeners = new Set<() => void>();

/**
 * The live read. A plain module variable and not React state, on purpose: this
 * is answered inside a native `keydown` listener in another component, in the
 * same tick as the key that is being judged.
 */
let open = false;

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): GuideState {
  return state;
}

/** Whether a tour dialog is on screen right now. */
export function isGuideOpen(): boolean {
  return open;
}

/**
 * The single line `Review.tsx` adds at the top of its handler:
 * `if (guideBlocksKeys(event)) return;`
 *
 * It takes the event rather than nothing so that the call site reads as a
 * decision about this key, and so that a later rule — "let Escape through" for
 * instance — has somewhere to live that is not the review screen.
 */
export function guideBlocksKeys(_event: KeyboardEvent): boolean {
  return open;
}

/** `<html data-guide-open>`, for anything that has to react in CSS. */
function markDocument(isOpen: boolean) {
  if (typeof document === 'undefined') return;
  if (isOpen) document.documentElement.setAttribute('data-guide-open', '');
  else document.documentElement.removeAttribute('data-guide-open');
}

/**
 * Open the tour for a path.
 *
 * The signal goes up first and the state second, so there is no instant in
 * which a dialog exists and the review screen still thinks its shortcuts are
 * live. A path with no steps is a no-op rather than an empty dialog.
 */
export function startGuide(pathname: string): boolean {
  const steps = stepsFor(pathname);
  if (steps.length === 0) return false;
  open = true;
  markDocument(true);
  state = { open: true, index: 0, steps };
  emit();
  return true;
}

export function stopGuide() {
  if (!open && !state.open) return;
  open = false;
  markDocument(false);
  state = CLOSED;
  emit();
}

export function nextStep() {
  if (!state.open) return;
  if (state.index + 1 >= state.steps.length) {
    stopGuide();
    return;
  }
  state = { ...state, index: state.index + 1 };
  emit();
}

export function backStep() {
  if (!state.open || state.index === 0) return;
  state = { ...state, index: state.index - 1 };
  emit();
}

/**
 * The one-time offer, and the only thing the tour remembers.
 *
 * Home offers it once per browser and never again, and never on any other
 * route — least of all `/review`, where an unasked-for dialog would land on top
 * of a leased episode.
 */
const SEEN_KEY = 'playerone.guide.seen';

export function guideOffered(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) !== null;
  } catch {
    /* A locked-down browser profile is not a reason to nag every load. */
    return true;
  }
}

export function markGuideOffered() {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* Nothing to do; the offer simply reappears next session. */
  }
}

/** The React face of the store. */
export function useGuide() {
  const current = useSyncExternalStore(subscribe, snapshot, () => CLOSED);
  return {
    open: current.open,
    index: current.index,
    steps: current.steps,
    step: current.steps[current.index] ?? null,
    start: useCallback((pathname: string) => startGuide(pathname), []),
    next: useCallback(() => nextStep(), []),
    back: useCallback(() => backStep(), []),
    stop: useCallback(() => stopGuide(), []),
    /** Whether this route has anything to show, for the trigger's disabled state. */
    available: useCallback((pathname: string) => stepsFor(pathname).length > 0, []),
  };
}
