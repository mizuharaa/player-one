import { DemoBypass } from '../ui/DemoBypass.tsx';
import { Failure } from '../ui/StatePanel.tsx';
import { BrandSlot } from '../shell/BrandSlot.tsx';
import { useEffect, useRef, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../api/types.ts';
import { BUILD_PROFILE } from '../api/config.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { e164 } from '../phone.ts';
import { Button, Film, Choice, CodeBoxes, Field, LegalLine, Note, Scrim, face, useInsets, } from '../ui.tsx';
import { useTheme } from '../theme.tsx';
import { ZaloSignIn, useZaloSignIn } from '../zalo.tsx';
import type { MessageKey } from '../i18n.ts';
import poster from '../../assets/hero/login-poster.jpg';
import loginFilm from '../../assets/hero/login.mp4';

/**
 * APP-01. The number, then the code that comes back over Zalo.
 *
 * SPEC.md §3 and §4. Two steps, still one component and still not a route:
 * this is not somewhere a collector navigates to, it is what the app is when
 * there is no session. The steps are two renders of one piece of state, so the
 * number, the revision counter and the in-flight guard survive moving between
 * them — which is the whole reason they were one screen before v2 and stay one
 * file now. **Nothing about the requests changed**: same two calls, same
 * refusal mapping, same locking, and the six recovery tests in
 * `test/signin-recovery.test.tsx` still describe this screen.
 *
 * **What this screen must never say.** `POST /auth/collector/request-code`
 * answers 204 for every number, enrolled or not, so that nobody can use this
 * app to find out which numbers belong to collectors; and
 * `POST /auth/collector/verify` answers one 401 whether the code was wrong,
 * expired, or guessed at six times. So sending always says the same sentence,
 * and a refusal always says the same sentence. A more helpful message here
 * would undo the reason those routes are shaped that way.
 *
 * A collector whose number has no Zalo account cannot receive a code at all —
 * the named refusal `zns_no_zalo_account`, recorded server-side against the
 * collector so an operator can find them. The app cannot see that and must not
 * pretend to: `signIn.codeSent` tells them to check Zalo, and the way out is a
 * person at a counter.
 *
 * **The hint comes before the press, not after it.** §3, and it is the most
 * consistent habit in the whole reference pass: `signIn.codeSent` is rendered
 * above the button rather than revealed by it, so the Zalo channel is
 * disclosed before a collector commits a phone number rather than after. It is
 * conditional by construction ("Nếu số này đã được đăng ký…") and therefore
 * says nothing the 204 is protecting.
 *
 * **The +86 note is keyed off the picker, not off the server.** `zns.ts`
 * accepts Vietnamese numbers only, so a +86 number will never receive a code.
 * Saying so is safe *because* the person chose +86 themselves: the sentence is
 * a fact about the country code in front of them and not an answer about
 * whether any number is enrolled. It sits directly under the country + number
 * row because it explains that row — not as a footnote at the foot of the
 * sheet and not as a toast. It does not block the submit; the request still
 * goes and still gets the same 204.
 *
 * **The keyboard is why both steps are a `KeyboardAvoidingView` over a
 * `ScrollView`.** Without it the Android keyboard covers the send control on a
 * 640 dp-tall phone and the screen is unfinishable — one of the "nothing has
 * functionality" reports. `height` on Android and `padding` on iOS, and
 * `keyboardShouldPersistTaps="handled"` so a tap on the button with the
 * keyboard open lands on the button instead of dismissing the keyboard.
 */

/**
 * The two the pilot accepts, and not a country list.
 *
 * Vietnam is where the collectors are. China is here because PaXini is in
 * Shenzhen and Daniel asked for both. With exactly two entries a modal with a
 * search field is machinery for nothing, so this is a two-item disclosure.
 */
const VN = { code: '+84', label: 'signIn.country.vn' as MessageKey };
const CN = { code: '+86', label: 'signIn.country.cn' as MessageKey };

/** Night scrim over the supplied login film; contrast proof samples this poster. */
const HERO_SCRIM = [[0, 0.2], [0.55, 0.55], [1, 0.55]] as const;

/** §4: the resend timer counts from arrival. */
const RESEND_SECONDS = 60;

/**
 * The Zalo mark, so a collector knows which app the code lands in.
 *
 * Drawn from Views: `react-native-svg` is not a dependency of this app (§20.1)
 * and a remote image would make the mark depend on the network the collector
 * has not signed in over yet. It is the recognisable part — the bubble with
 * its tail — reduced to what holds at 24dp, not a reproduction of the
 * wordmark.
 *
 * It is drawn in `action`/`actionInk`, the ink pair, and not in a blue. The
 * blue it used was `tech[500]`, which is PaXini's mark: a Vietnamese messaging
 * app's logo painted in the camera vendor's brand colour was already the wrong
 * blue, and tech is the partner lockup and nothing else now.
 */
function ZaloMark({ label }: { label: string }) {
  const theme = useTheme();
  const size = theme.space[6];
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel={label}
      style={{
        width: size,
        height: size,
        borderRadius: theme.radius.sm,
        backgroundColor: theme.color.action,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <View
        style={{
          position: 'absolute',
          left: theme.space[1],
          bottom: -theme.space[1],
          width: theme.space[2],
          height: theme.space[2],
          backgroundColor: theme.color.action,
          transform: [{ rotate: '45deg' }],
        }}
      />
      <Text
        style={{
          color: theme.color.actionInk,
          fontFamily: face(theme),
          ...theme.collector.type.caption,
fontWeight: theme.fontWeight.bold,
        }}
      >
        Z
      </Text>
    </View>
  );
}

/** The pre-announcement, and the same row on both steps. */
function ZaloHint() {
  const theme = useTheme();
  const tt = useT();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
      <ZaloMark label={tt('signIn.zaloMark')} />
      <Text
        style={{
          flexGrow: 1,
          flexShrink: 1,
          color: theme.color.mutedForeground,
          fontFamily: face(theme),
          ...theme.collector.type.caption,

        }}
      >
        {tt('signIn.codeSent')}
      </Text>
    </View>
  );
}

export function SignIn({
  onSignedIn,
  onBack,
}: {
  onSignedIn: () => void;
  /** Back to the landing. Sign-in is not a route, so it cannot use the stack. */
  onBack?: () => void;
}) {
  const [heroVisible, setHeroVisible] = useState(true);
  const api = useApi();
  const tt = useT();
  const theme = useTheme();
  const insets = useInsets();
  const [country, setCountry] = useState(VN);
  const [picking, setPicking] = useState(false);
  const [pickerFocused, setPickerFocused] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  /** True when the server filled the code in, so the screen can say why. */
  const [filled, setFilled] = useState(false);
  /** §4's shake fires on a count, not a flag: two wrong codes shake twice. */
  const [refused, setRefused] = useState(0);
  const [left, setLeft] = useState(0);
  /**
   * Zalo Login, owner's decision of 2026-09-16 — the first-class way in, with
   * the code path below it as the fallback. It owns the whole browser hop,
   * including the `playerone://signed-in` link coming back, so this screen only
   * places it and hands it the same `onSignedIn` the code path calls.
   */
  const zalo = useZaloSignIn({ onSignedIn });
  /**
   * The demo bypass sheet, owner's request of 2026-09-16. See `DemoBypass.tsx`.
   * State and not a route, for the reason this whole screen is not one.
   */
  const [demo, setDemo] = useState(false);
  const mounted = useRef(true);
  const revision = useRef(0);
  const submitting = useRef<'request' | 'verify' | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; revision.current += 1; };
  }, []);

  /** E.164, which is what `api.requestSignInCode` and `api.signIn` both take. */
  const number = e164(country.code, phone);

  /** One message per named refusal, and one fallback that admits nothing. */
  const failed = (err: unknown): void => {
    const refusal = err instanceof ApiError ? err.code : '';
    if (refusal === 'server_unreachable') setProblem('state.offline');
    else if (refusal === 'rate_limited') setProblem('signIn.rateLimited');
    else if (refusal === 'sign_in_unavailable') setProblem('signIn.unavailable');
    else if (refusal === 'credentials') setProblem('signIn.badCode');
    else setProblem('common.actionFailed');
  };

  const request = useMutation({
    mutationFn: ({ phone: asked }: { phone: string; revision: number }) => api.requestSignInCode(asked),
    onSuccess: (result, attempt) => {
      if (!mounted.current || attempt.revision !== revision.current) return;
      setProblem(null);
      setSent(true);
      setLeft(RESEND_SECONDS);
      // A demonstration server echoes this one number's code. Ordinary servers
      // send nothing back and this is never reached.
      const demo = result?.demo_code;
      setCode(demo ?? '');
      setFilled(demo !== undefined);
    },
    onError: (error, attempt) => {
      if (mounted.current && attempt.revision === revision.current) failed(error);
    },
    onSettled: () => { submitting.current = null; },
  });

  const verify = useMutation({
    mutationFn: (attempt: { phone: string; code: string; revision: number }) => api.signIn(attempt.phone, attempt.code),
    onSuccess: (_result, attempt) => {
      if (mounted.current && attempt.revision === revision.current) onSignedIn();
    },
    onError: (error, attempt) => {
      if (mounted.current && attempt.revision === revision.current) {
        failed(error);
        setRefused((n) => n + 1);
      }
    },
    onSettled: () => { submitting.current = null; },
  });
  const pending = request.isPending || verify.isPending;

  /** The countdown that disables resend. One interval, cleared on leaving. */
  useEffect(() => {
    if (left <= 0) return;
    const tick = setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    return () => clearInterval(tick);
  }, [left]);

  const sendCode = () => {
    // A synchronous guard also covers two taps before React rerenders disabled.
    if (submitting.current) return;
    submitting.current = 'request';
    verify.reset();
    setProblem(null);
    setCode('');
    setFilled(false);
    request.mutate({ phone: number, revision: revision.current });
  };

  const submitCode = (value: string) => {
    if (submitting.current || value.length !== 6) return;
    submitting.current = 'verify';
    setProblem(null);
    verify.mutate({ phone: number, code: value, revision: revision.current });
  };

  const pick = (next: typeof VN) => {
    setCountry(next);
    setPicking(false);
  };

  const editPhone = (next: string) => {
    // Verification persists this phone's token. Lock its identity even for an
    // edit arriving before the disabled field rerenders.
    if (submitting.current === 'verify') return;
    // A revision also rejects an old response after editing A → B → A.
    revision.current += 1;
    setPhone(next);
    setSent(false);
    setProblem(null);
    setLeft(0);
    // A code belongs to the number it was sent for, so editing the number
    // clears it. Unconditional: `filled` is turned off as soon as the
    // collector types in the code box, and a stale code must still be cleared.
    setCode('');
    setFilled(false);
  };

  const back = (
    label: string,
    onPress: () => void,
    onDark: boolean,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={theme.space[3]}
      style={{
        alignSelf: 'flex-start',
        // 44 pt, and it applies to the back control too (§18).
        minHeight: theme.space[12],
        minWidth: theme.space[12],
        justifyContent: 'center',
        // Over the hero it is an ink pill, not bare type. The scrim is
        // transparent at the top by design — it is built to darken toward the
        // wordmark at the foot — so a white label up there lands on whatever
        // the film happens to be showing, and on this clip that is a sunlit
        // wall. The pill gives it a ground the film cannot change.
        ...(onDark
          ? {
              backgroundColor: theme.collector.nightSurface,
              borderRadius: theme.radius.pill,
              paddingHorizontal: theme.space[4],
            }
          : {}),
      }}
    >
      <Text
        style={{
          color: onDark ? theme.collector.glow : theme.color.foreground,
          fontFamily: face(theme),
          ...theme.collector.type.caption,
fontWeight: theme.fontWeight.medium,
        }}
      >
        ← {label}
      </Text>
    </Pressable>
  );

  /* ---------------------------------------------------------------- *
   * §4. The code. No hero — the collector is mid-task and a photograph
   * here is noise.
   * ---------------------------------------------------------------- */
  if (sent) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={{ flex: 1, backgroundColor: theme.color.background }}
      >
        <ScrollView
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={{
            flexGrow: 1,
            padding: theme.space[5],
            paddingTop: insets.top + theme.space[4],
            gap: theme.space[5],
          }}
        >
          {back(tt('common.back'), () => editPhone(phone), false)}

          <Text
            accessibilityRole="header"
            style={{
              color: theme.color.foreground,
              fontFamily: face(theme),
              ...theme.collector.type.h1,

              fontWeight: theme.fontWeight.display,
              letterSpacing: -0.5,
            }}
          >
            {tt('signIn.code')}
          </Text>
          <Text
            style={{
              color: theme.color.mutedForeground,
              fontFamily: face(theme),
              ...theme.collector.type.body,

            }}
          >
            {tt('signIn.sentTo').replace('{phone}', number)}
          </Text>

          <CodeBoxes
            value={code}
            label={tt('signIn.code')}
            checking={verify.isPending}
            errorAt={refused}
            editable={!pending}
            onChangeText={(next) => {
              setCode(next);
              setFilled(false);
              setProblem(null);
              // §4: submission is automatic on the sixth digit. A keypad
              // already ends in a commitment, so a submit button under it is
              // a second commitment for the same act.
              if (next.length === 6) submitCode(next);
            }}
          />

          {/*
            The error slot has a reserved height, so a refusal does not shove
            the resend control down the screen under the collector's thumb.
          */}
          <View style={{ minHeight: Math.round(theme.fontSize.sm * 1.4) }}>
            {verify.isPending ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: theme.color.mutedForeground,
                  fontFamily: face(theme),
                  ...theme.collector.type.caption,

                }}
              >
                {tt('signIn.checking')}
              </Text>
            ) : problem === 'state.offline' ? <Failure error={new ApiError('server_unreachable')} text={tt(problem)} onRetry={() => verify.isError ? submitCode(code) : sendCode()} busy={pending} /> : problem !== null ? (
              <Text
                accessibilityLiveRegion="polite"
                style={{
                  color: theme.color.verdict.reject.fg,
                  fontFamily: face(theme),
                  ...theme.collector.type.caption,

                }}
              >
                {tt(problem)}
              </Text>
            ) : null}
          </View>

          {/*
            While the timer runs this carries `accessibilityState.disabled` as
            well as its dimmed fill, and `onPress` is never a no-op — `Button`
            passes `disabled` to the Pressable and to the state. A control that
            looks disabled and announces itself as enabled is worse than one
            that is plainly gone: TalkBack reads it as actionable, the
            collector double-taps, and nothing happens.
          */}
          <Button
            label={left > 0 ? tt('signIn.resendIn').replace('{s}', String(left)) : tt('signIn.resendCode')}
            variant="ghost"
            disabled={pending || left > 0}
            onPress={sendCode}
          />

          {/*
            The demonstration server's own code, and the one control §4 does
            not otherwise have. A real server never sends `demo_code`, so this
            never renders in the pilot: auto-submit needs a sixth *keystroke*,
            and a code that arrived pre-filled has none — without this, a demo
            build would fill the boxes and offer no way to commit them.
          */}
          {filled ? (
            <View style={{ gap: theme.space[3] }}>
              <Note text={tt('signIn.demoFilled')} />
              <Button label={tt('signIn.submit')} disabled={pending} onPress={() => submitCode(code)} />
            </View>
          ) : null}

          <View style={{ marginTop: 'auto', paddingTop: theme.space[5] }}>
            <ZaloHint />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  /* ---------------------------------------------------------------- *
   * §3. The number. Glovo's login: a brand hero on top, a rounded
   * surface sheet below carrying the form and sitting ON the brand.
   * ---------------------------------------------------------------- */
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: theme.color.background }}
    >
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, aspectRatio: 16 / 11 }}>
        <Film source={loginFilm} poster={poster} label={tt('landing.videoLabel')} fade={theme.duration.base} active={heroVisible} />
        <Scrim stops={HERO_SCRIM} />
      </View>
      <ScrollView
        onScroll={event => setHeroVisible(event.nativeEvent.contentOffset.y <= 0)} scrollEventThrottle={32}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ flexGrow: 1 }}
      >
        <View style={{ aspectRatio: 16 / 11 }}>
          {/* The ratio is on the box, never on the `Image` — see §2's note. */}
          <View
            style={{
              position: 'absolute',
              left: theme.space[5],
              bottom: theme.space[5] + theme.space[6],
              minHeight: 38,
            }}
          >
            <BrandSlot color={theme.color.discover.surface} />
          </View>
          {onBack === undefined ? null : (
            <View style={{ position: 'absolute', top: insets.top, left: theme.space[5] }}>
              {back(tt('common.back'), onBack, true)}
            </View>
          )}
        </View>

        {/*
          The sheet overlaps the hero — the Glovo/Oura move that makes the form
          sit ON the brand rather than under it, and the cheapest way to get
          "curvy" without one decorative shape.
        */}
        <View
          style={{
            flex: 1,
            marginTop: -theme.space[6],
            borderTopLeftRadius: theme.radius.xl,
            borderTopRightRadius: theme.radius.xl,
            backgroundColor: theme.color.surface,
            padding: theme.space[5],
            gap: theme.space[4],
          }}
        >
          <Text
            accessibilityRole="header"
            style={{
              color: theme.color.foreground,
              fontFamily: face(theme),
              ...theme.collector.type.h1,

              fontWeight: theme.fontWeight.display,
              letterSpacing: -0.5,
            }}
          >
            {tt('signIn.title')}
          </Text>
          <Text
            style={{
              color: theme.color.mutedForeground,
              fontFamily: face(theme),
              ...theme.collector.type.body,

            }}
          >
            {tt('signIn.intro')}
          </Text>

          {/*
            Above the phone field, because it is the way in that works for
            anybody with a Zalo account and the code path is the fallback
            underneath it. The "hoặc dùng số điện thoại" line the block ends
            with is what says so, rather than a heading over the field.
          */}
          <ZaloSignIn state={zalo} />

          {/*
            The code and the number share one row, the way a phone number is
            actually written — so the label belongs over the *pair*, at the
            same left edge as the heading, the sentence and the button. It used
            to be the field's own label and printed 80 dp adrift of every other
            element on the screen, with nothing above the `+84` box at all.
          */}
          <View style={{ gap: theme.space[1] }}>
            <Text
              style={{
                color: theme.color.mutedForeground,
                fontFamily: face(theme),
                ...theme.collector.type.caption,
}}
            >
              {tt('signIn.phone')}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space[2] }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${tt('signIn.countryCode')}: ${tt(country.label)}`}
                accessibilityState={{ expanded: picking }}
                onPress={() => setPicking(!picking)}
                onFocus={() => setPickerFocused(true)}
                onBlur={() => setPickerFocused(false)}
                style={({ pressed }) => ({
                  minHeight: theme.space[12],
                  minWidth: theme.space[12],
                  justifyContent: 'center',
                  // The focus ring is a colour change on a border that is
                  // already there, as on `Field`, so gaining focus never moves
                  // the row.
                  borderWidth: pickerFocused ? 2 : 1,
                  borderColor: pickerFocused ? theme.collector.plum : theme.color.borderStrong,
                  borderRadius: theme.radius.base,
                  paddingHorizontal: theme.space[3] - (pickerFocused ? 1 : 0),
                  backgroundColor: pressed ? theme.color.muted : theme.color.background,
                })}
              >
                <Text
                  style={{
                    color: theme.color.foreground,
                    fontFamily: face(theme),
                    ...theme.collector.type.body,
fontWeight: theme.fontWeight.medium,
                  }}
                >
                  {country.code} ▾
                </Text>
              </Pressable>
              <View style={{ flexGrow: 1, flexShrink: 1 }}>
                <Field
                  label={tt('signIn.phone')}
                  labelHidden
                  value={phone}
                  editable={!verify.isPending}
                  onChangeText={editPhone}
                  keyboardType="phone-pad"
                />
              </View>
            </View>
            {/*
              Under the row it explains, inside the same field group — not a
              footnote at the foot of the sheet and not a toast.
            */}
            {country.code === CN.code ? (
              <Text
                style={{
                  color: theme.color.mutedForeground,
                  fontFamily: face(theme),
                  ...theme.collector.type.caption,

                  paddingTop: theme.space[1],
                }}
              >
                {tt('signIn.chinaNote')}
              </Text>
            ) : null}
          </View>

          {picking ? (
            <View style={{ gap: theme.space[2] }}>
              <Choice
                label={tt(VN.label)}
                describedBy={tt('signIn.countryCode')}
                selected={country.code === VN.code}
                onPress={() => pick(VN)}
              />
              <Choice
                label={tt(CN.label)}
                describedBy={tt('signIn.countryCode')}
                selected={country.code === CN.code}
                onPress={() => pick(CN)}
              />
            </View>
          ) : null}

          <ZaloHint />

          {/*
            Between the field and the CTA, because on this screen pressing the
            button IS the consent. On the welcome screen (§2) the same two
            links sit below the CTA, where they are reference rather than
            consent. That placement is positional, not arbitrary — and it is
            why it sits with the sentence it belongs to rather than floating
            above the button at the foot of the sheet.
          */}
          <LegalLine />

          {/*
            The demo bypass, owner's request of 2026-09-16, and the ONLY way
            into it. Debugging and the Thursday demonstration: the pipelines
            have to be showable when no sign-in channel delivers a code.

            Not rendered at all on the Play profile — the same gate the Server
            row in `Profile.tsx` uses, and the same reason: a control that must
            not exist in a shipped app is better absent than disabled. It is a
            ghost under the legal line rather than a third button in the stack
            above, because it is not a way in for a collector and must not read
            as one; `test/demo-bypass.test.tsx` measures both the presence and
            the absence.
          */}
          {BUILD_PROFILE === 'play' ? null : (
            <Button label={tt('demo.entry')} variant="ghost" onPress={() => setDemo(true)} />
          )}
          {demo ? <DemoBypass onSignedIn={onSignedIn} onClose={() => setDemo(false)} /> : null}

          {problem !== null ? <Failure error={problem === 'state.offline' ? new ApiError('server_unreachable') : undefined} text={tt(problem)} onRetry={() => verify.isError ? submitCode(code) : sendCode()} busy={pending} /> : null}

          <View style={{ marginTop: 'auto', paddingTop: theme.space[5] }}>
            <Button label={tt('signIn.sendCode')} disabled={pending} onPress={sendCode} />
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
