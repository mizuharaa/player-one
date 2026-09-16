import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, Text, View } from 'react-native';
import zaloLogo from '../assets/zalo.png';
import { ApiError } from './api/types.ts';
import { useApi } from './api/context.tsx';
import { useT } from './locale.tsx';
import type { MessageKey } from './i18n.ts';
import { useTheme } from './theme.tsx';
import { face } from './ui.tsx';

/**
 * Signing in with the Zalo account the collector already has. APP-01.
 *
 * Owner's decision, 2026-09-16, and it overrides the 2026-08-29 rule that a
 * code is delivered over ZNS and that no second channel is built: VNG's ZNS
 * Official Account is not available, so the code channel delivers nothing to
 * anybody. `packages/api/src/zalo-login.ts` argues the server half.
 *
 * One file because it is one concern, used by two screens (§2's welcome and
 * §3's sign-in) and by neither of them differently. It holds the mark, the
 * button and the hook that owns the whole hop:
 *
 *   1. `POST /auth/collector/zalo/start` says where to send the browser.
 *   2. `Linking.openURL` opens Zalo's own permission screen.
 *   3. Zalo redirects to the server, which redirects to `playerone://signed-in`.
 *   4. This app reads the ticket off that link and trades it for its token.
 *
 * ## Why `Linking` and not `expo-web-browser`
 *
 * ponytail: neither `expo-web-browser` nor `expo-linking` is a dependency of
 * this app, and `Linking` from React Native does both halves — `openURL` and
 * the `url` event — in the two calls below. `expo-web-browser` would give an
 * in-app tab that closes itself, which is nicer and is not worth a native
 * module: the collector's own Zalo app handles `oauth.zaloapp.com` on a phone
 * that has Zalo installed, and it is installed, because that is the whole
 * premise of this route. Add it if a collector without the Zalo app ever has
 * to complete this in a browser.
 *
 * ## What this screen must not claim
 *
 * The phone-code path is untouched and stays underneath, because a collector
 * whose Zalo sign-in fails has to have somewhere to go. And a failure here is
 * named — the server redirects with `?error=<name>` — so unlike the code path,
 * where every refusal is deliberately one sentence, these may say what
 * happened: none of them answers "is this number enrolled", which is the only
 * question the code path's single 401 exists to refuse.
 */

/**
 * The link the server redirects the browser to. Matches `APP_DEEP_LINK` in
 * `packages/api/src/zalo-login.ts`, and `expo.scheme` in `app.json` is what
 * makes Android and iOS hand it to this app.
 *
 * ponytail: one scheme for every build profile. `app.config.cjs` gives the
 * demo build the package suffix `.demo`, so a phone with BOTH the demo and the
 * Play build installed claims `playerone://` twice and Android asks which. It
 * is not worth a per-profile scheme: the two are never on a collector's phone
 * at once, and a demo device that has both wants the chooser rather than a
 * silent guess. Give the demo its own scheme if that ever stops being true.
 */
export const SIGNED_IN_LINK = 'playerone://signed-in';

/**
 * `Linking.getInitialURL()` keeps answering the URL the app was launched with,
 * for the whole life of the process. Read once, or a sign-out and a second
 * sign-in would try to spend the same ticket again and show a refusal for a
 * sign-in that actually worked.
 */
let launchLinkRead = false;

/** For a test that mounts this twice in one process. */
export const resetLaunchLink = (): void => {
  launchLinkRead = false;
};

/**
 * Zalo's blue, and it is a constant here rather than a theme token on purpose.
 *
 * The theme is PlayerOne's palette; this is somebody else's brand, and a third
 * party's colour in `theme.collector` would be read as ours and reused
 * somewhere it does not belong. It is also why the mark is white on it rather
 * than `sun`: this control is a Zalo lockup, and the sun primary stays on the
 * app's own primary action.
 */
export const ZALO_BLUE = '#0068FF';
const ZALO_INK = '#FFFFFF';

/** Official, unmodified asset from zalo.me's CDN; keep its blue on white. */
export function ZaloMark({ size, label }: { size: number; label?: string }) {
  return <View style={{ padding: 4, backgroundColor: ZALO_INK, borderRadius: 4 }}>
    <Image source={zaloLogo} style={{ width: size * 77 / 28, height: size }} resizeMode="contain" accessibilityLabel={label} />
  </View>;
}

/** What the hook is showing: nothing, a spinner, or a named refusal. */
export type ZaloSignInState = {
  /** True only after the mount-time availability probe succeeds. */
  available: boolean;
  busy: boolean;
  problem: MessageKey | null;
  /** Open Zalo. Safe to call twice; the second call is a no-op while busy. */
  open: () => void;
};

/** One refusal name → one sentence. Named, because a named failure may be named. */
function sentenceFor(name: string | null): MessageKey {
  switch (name) {
    case 'zalo_denied':
      return 'signIn.zaloDenied';
    case 'zalo_ticket_spent':
    case 'zalo_state_unknown':
    case 'zalo_state_expired':
      return 'signIn.zaloExpired';
    case 'rate_limited':
      return 'signIn.rateLimited';
    case 'zalo_code_refused':
    case 'zalo_profile_refused':
    case 'zalo_unreachable':
      return 'signIn.zaloFailed';
    default:
      return 'common.actionFailed';
  }
}

export function useZaloSignIn({ onSignedIn }: { onSignedIn: () => void }): ZaloSignInState {
  const api = useApi();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  const alive = useRef(true);
  /**
   * Every ticket this screen has already presented, and it is a set rather
   * than an in-flight boolean on purpose.
   *
   * Android delivers the `url` event to a mounted screen and can deliver the
   * same link again — on resume, or alongside `getInitialURL` in the same
   * tick. A ticket is single-use, so the second presentation would be refused
   * by the server and the collector would be shown a failure for a sign-in
   * that had just worked. Added BEFORE the await, so it is also the
   * synchronous in-flight guard.
   */
  const presented = useRef(new Set<string>());

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    // The existing start route is the only availability signal. A probe must
    // not replace the persisted state of a login returning from Zalo.
    void api.startZaloSignIn({ probeOnly: true }).then(
      () => { if (active) setAvailable(true); },
      () => {},
    );
    return () => { active = false; };
  }, [api]);

  const redeem = useCallback(
    async (ticket: string, state: string) => {
      if (presented.current.has(ticket)) return;
      presented.current.add(ticket);
      if (alive.current) {
        setBusy(true);
        setProblem(null);
      }
      try {
        await api.signInWithTicket(ticket, state);
        if (alive.current) onSignedIn();
      } catch (err) {
        if (alive.current) setProblem(sentenceFor(err instanceof ApiError ? err.code : null));
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [api, onSignedIn],
  );

  /** The ticket, or the named failure, off one `playerone://signed-in` link. */
  const arrive = useCallback(
    (url: string | null) => {
      if (url === null || !url.startsWith(SIGNED_IN_LINK)) return;
      /**
       * Parsed by hand and not with `new URL()`: `playerone:` is not a special
       * scheme, and how a runtime's URL parser treats the query of one is not
       * something to depend on across Hermes, JSC and a browser harness.
       */
      const mark = url.indexOf('?');
      const params = new URLSearchParams(mark === -1 ? '' : url.slice(mark + 1));
      const ticket = params.get('ticket');
      if (ticket !== null && ticket !== '') {
        /**
         * The state rides back with the ticket, and the client compares it
         * against the one it stored before the browser opened. This screen
         * does not do the comparison itself: the stored value lives in the
         * keystore behind the client, and a check here would be a second copy
         * of the rule in the place with no access to the fact.
         *
         * A link with no state, or the wrong one, is refused as
         * `zalo_state_unknown` — it is not this phone's sign-in, and redeeming
         * it would put the collector into whichever account forged it.
         */
        void redeem(ticket, params.get('state') ?? '');
        return;
      }
      if (alive.current) {
        setBusy(false);
        setProblem(sentenceFor(params.get('error')));
      }
    },
    [redeem],
  );

  useEffect(() => {
    const subscription = Linking.addEventListener('url', (event) => arrive(event.url));
    if (!launchLinkRead) {
      launchLinkRead = true;
      // A keystore-style failure here must not stop the screen from working.
      void Linking.getInitialURL().then(arrive, () => {});
    }
    return () => subscription.remove();
  }, [arrive]);

  const open = useCallback(() => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    void (async () => {
      try {
        const { url } = await api.startZaloSignIn();
        await Linking.openURL(url);
      } catch (err) {
        if (!alive.current) return;
        const code = err instanceof ApiError ? err.code : null;
        setProblem(code === 'zalo_not_configured' ? 'signIn.zaloUnavailable' : sentenceFor(code));
      } finally {
        /**
         * Cleared even on success. The app is in the background by now, and if
         * the collector backs out of Zalo without finishing there is no link
         * coming — a spinner left running would be a screen with no way out.
         */
        if (alive.current) setBusy(false);
      }
    })();
  }, [api, busy]);

  return { available, busy, problem, open };
}

/**
 * The control. Zalo's blue, Zalo's mark, and the app's own pill geometry.
 *
 * Not a `variant` on `Button`: that component's fills come from
 * `theme.collector` and this one must not, for the reason `ZALO_BLUE` gives.
 * Everything else about it — the 44 pt minimum, the pill radius, the focus
 * ring, the busy indicator inside the label row, `accessibilityState` carrying
 * `disabled` and `busy` — is copied from `Button` deliberately, so the two sit
 * next to each other without one of them looking like a different app.
 */
export function ZaloButton({
  onPress,
  busy = false,
  onDark = false,
}: {
  onPress: () => void;
  busy?: boolean;
  /** Over the landing's film, where the focus ring has to be the glow. */
  onDark?: boolean;
}) {
  const theme = useTheme();
  const c = theme.collector;
  const tt = useT();
  const [focused, setFocused] = useState(false);
  const label = tt('signIn.zalo');
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: busy, busy }}
      aria-busy={busy}
      disabled={busy}
      onPress={onPress}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={({ pressed }) => ({
        backgroundColor: ZALO_BLUE,
        borderWidth: 2,
        borderColor: focused ? (onDark ? c.glow : c.plum) : 'transparent',
        borderRadius: c.radius.pill,
        paddingHorizontal: c.gutter,
        paddingVertical: theme.space[3],
        minHeight: theme.space[12],
        minWidth: theme.space[12],
        maxWidth: '100%',
        flexDirection: 'row',
        gap: theme.space[2],
        alignItems: 'center',
        justifyContent: 'center',
        opacity: busy ? 0.6 : pressed ? 0.85 : 1,
      })}
    >
      {busy ? (
        <ActivityIndicator color={ZALO_INK} />
      ) : (
        <ZaloMark size={theme.space[5]} />
      )}
      <Text
        style={{
          ...c.type.body,
          color: ZALO_INK,
          fontFamily: face(theme),
          fontWeight: '600',
          textAlign: 'center',
          flexShrink: 1,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * The button, its spinner sentence and its refusal, as one block.
 *
 * Both screens want exactly this and neither wants to decide the order, so the
 * order is here: the control, then the status line under it, then the "or use
 * your number" divider that says the phone field below is still the way in.
 * Nothing renders at all once the server has said there is no Zalo app.
 */
export function ZaloSignIn({
  state,
  onDark = false,
}: {
  state: ZaloSignInState;
  onDark?: boolean;
}) {
  const theme = useTheme();
  const tt = useT();
  if (!state.available && !state.busy && state.problem === null) return null;
  const muted = onDark ? theme.collector.glow : theme.color.mutedForeground;
  return (
    <View style={{ gap: theme.space[2] }}>
      {state.available ? <ZaloButton onPress={state.open} busy={state.busy} onDark={onDark} /> : null}
      {/*
        A reserved height, so a refusal or a spinner sentence does not shove
        the phone field down the screen under the collector's thumb. The same
        rule §4 applies to the code screen's error slot.
      */}
      <View style={{ minHeight: Math.round(theme.fontSize.sm * 1.4) * 2 }}>
        {state.busy ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{ ...theme.collector.type.caption, color: muted, fontFamily: face(theme) }}
          >
            {tt('signIn.zaloOpening')}
          </Text>
        ) : state.problem !== null ? (
          <Text
            accessibilityLiveRegion="polite"
            style={{
              ...theme.collector.type.caption,
              color: onDark ? theme.collector.glow : theme.color.verdict.reject.fg,
              fontFamily: face(theme),
            }}
          >
            {tt(state.problem)}
          </Text>
        ) : null}
      </View>
      <Text
        style={{
          ...theme.collector.type.caption,
          color: muted,
          fontFamily: face(theme),
          textAlign: 'center',
        }}
      >
        {tt('signIn.zaloOr')}
      </Text>
    </View>
  );
}
