import { createContext, use, type ReactNode } from 'react';

/**
 * Leaving the session, offered to the one screen that should offer it.
 *
 * It used to be an app-level control: a ghost button rendered as a sibling of
 * the whole navigation stack in `App.tsx`, so it sat across the foot of every
 * signed-in screen, below the tab bar and outside the bottom system inset — a
 * second bar of chrome under the primary one, on the gesture pill, giving an
 * account action the same permanent prominence as the four destinations.
 * `DESIGN.md` orders a screen by what can cost somebody money and allows one
 * hero on it; a control repeated on all four tabs is neither. It is at the foot
 * of Home now, which is where the collector's name and the language chip
 * already are, and which is the pairing the console makes too.
 *
 * A context rather than a prop, because a screen is reached through `SCREENS`
 * and that registry hands its components nothing — the same reason `nav`,
 * `locale` and `theme` are contexts. Its own module rather than `App.tsx`, so
 * a screen importing it does not import the app that renders the screen.
 *
 * The default is a no-op: a screen rendered outside a session — the browser
 * harness's `?screen=` entry points — has no session to leave.
 */
/**
 * `landing` is the one option, and it is not configuration: the Profile
 * screen's Server sheet ends the session for a different reason than Log out
 * does, and the app comes back to a different door. An options object rather
 * than a positional flag because `Button` forwards its press event to
 * `onPress`, so `onPress={signOut}` would hand a truthy event to a boolean
 * parameter and every log-out would take the server-change path.
 */
export type SignOut = (options?: { landing?: boolean }) => void;

const SignOutContext = createContext<SignOut>(() => {});

export function SignOutProvider({ signOut, children }: { signOut: SignOut; children: ReactNode }) {
  return <SignOutContext value={signOut}>{children}</SignOutContext>;
}

export const useSignOut = (): SignOut => use(SignOutContext);
