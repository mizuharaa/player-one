import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { ApiError } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { e164 } from '../phone.ts';
import { Button, Choice, Field, LegalLine, Note, face, topInset } from '../ui.tsx';
import { Panda } from '../identity/Panda.tsx';
import { useTheme } from '../theme.tsx';
import type { MessageKey } from '../i18n.ts';

/**
 * APP-01. The number, then the code that comes back over Zalo.
 *
 * Two steps in one screen and not two routes: this is not somewhere a collector
 * navigates to, it is what the app is when there is no session, so it has no
 * entry in the route registry and no Back.
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
 * **The +86 note is keyed off the picker, not off the server.** `zns.ts`
 * accepts Vietnamese numbers only, so a +86 number will never receive a code.
 * Saying so is safe *because* the person chose +86 themselves: the sentence is
 * a fact about the country code in front of them and not an answer about
 * whether any number is enrolled, so it leaks nothing the 204 is protecting.
 * It does not block the submit — the request still goes, and still gets the
 * same 204 as every other number.
 *
 * **Composition**: the lavender wash the whole product stands on, one large
 * heading, one prominent field, the legal line, a full-width pill. It carried
 * two blurred discs of sun and bamboo behind the form until 2026-09-07; that
 * was an exception granted against a white world, `DESIGN.md` retires it
 * because the world it was an exception to is gone, and the discs overhung the
 * page by 64dp, which the spacing audit read — correctly — as a clip. The page
 * is the ground now.
 *
 * It does not use `Screen`, whose header bar is for a destination the collector
 * navigated to; this is the app's front door and the heading is the page.
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

/**
 * The Zalo mark, so a collector knows which app the code lands in.
 *
 * Drawn from Views: `react-native-svg` is not a dependency of this app and a
 * remote image would make the mark depend on the network the collector has not
 * signed in over yet. It is the recognisable part — the bubble with its tail —
 * reduced to what holds at 24dp, not a reproduction of the wordmark.
 *
 * It is drawn in `action`/`actionInk`, the ink pair, and not in a blue. The
 * blue it used was `tech[500]`, which is PaXini's mark: a Vietnamese messaging
 * app's logo painted in the camera vendor's brand colour was already the wrong
 * blue, and tech is the partner lockup and nothing else now. What carries the
 * recognition at 24dp is the shape — a bubble with a tail and a Z — so the
 * mark keeps that and takes the scheme's ink, which inverts with the page the
 * way every other glyph in this app does.
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
          fontSize: theme.fontSize.sm,
          fontWeight: theme.fontWeight.bold,
        }}
      >
        Z
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
  const api = useApi();
  const tt = useT();
  const theme = useTheme();
  const [country, setCountry] = useState(VN);
  const [picking, setPicking] = useState(false);
  const [pickerFocused, setPickerFocused] = useState(false);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<MessageKey | null>(null);
  /** True when the server filled the code in, so the screen can say why. */
  const [filled, setFilled] = useState(false);
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
    if (refusal === 'rate_limited') setProblem('signIn.rateLimited');
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
      if (mounted.current && attempt.revision === revision.current) failed(error);
    },
    onSettled: () => { submitting.current = null; },
  });
  const pending = request.isPending || verify.isPending;

  const sendCode = () => {
    // A synchronous guard also covers two taps before React rerenders disabled.
    if (submitting.current) return;
    submitting.current = 'request';
    setProblem(null);
    setCode('');
    setFilled(false);
    request.mutate({ phone: number, revision: revision.current });
  };

  const pick = (next: typeof VN) => {
    setCountry(next);
    setPicking(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.color.background }}>
      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{
          flexGrow: 1,
          paddingHorizontal: theme.space[5],
          paddingTop: topInset(theme.space[6]) + theme.space[2],
          paddingBottom: theme.space[6],
          gap: theme.space[4],
        }}
      >
        {onBack === undefined ? null : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tt('common.back')}
            onPress={onBack}
            hitSlop={theme.space[3]}
            style={{
              alignSelf: 'flex-start',
              minHeight: theme.space[6],
              justifyContent: 'center',
            }}
          >
            {/* Ink, not tech blue, and the same weight `Header` gives its own
                Back: tech is PaXini's mark now and is not a link colour
                anywhere in this app. This screen hand-rolls the control because
                sign-in is not a route and has no stack to pop. */}
            <Text
              style={{
                color: theme.color.foreground,
                fontFamily: face(theme),
                fontSize: theme.fontSize.sm,
                fontWeight: theme.fontWeight.medium,
              }}
            >
              ← {tt('common.back')}
            </Text>
          </Pressable>
        )}

        <View style={{ paddingTop: theme.space[10], gap: theme.space[3] }}>
          <Text
            accessibilityRole="header"
            style={{
              color: theme.color.foreground,
              fontFamily: face(theme),
              fontSize: theme.fontSize['2xl'],
              lineHeight: theme.fontSize['2xl'] * 1.15,
              fontWeight: theme.fontWeight.display,
              letterSpacing: -1,
            }}
          >
            {tt('signIn.title')}
          </Text>
          <Text
            style={{
              color: theme.color.mutedForeground,
              fontFamily: face(theme),
              fontSize: theme.fontSize.base,
              lineHeight: theme.fontSize.base * 1.5,
            }}
          >
            {tt('signIn.intro')}
          </Text>
        </View>

        {/*
          The code and the number share one row, the way a phone number is
          actually written — so the label belongs over the *pair*, at the same
          left edge as the heading, the sentence and the button.

          It used to be the field's own label and printed at x=100.17 against a
          20dp margin: 80.17dp adrift of every other element on the screen,
          with nothing above the `+84` box at all. That is this app's version
          of the caption-to-image offset the landing shipped, and the fix is
          the same one — the label goes over the whole thing it names.
        */}
        <View style={{ gap: theme.space[1] }}>
          <Text
            style={{
              color: theme.color.mutedForeground,
              fontFamily: face(theme),
              fontSize: theme.fontSize.sm,
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
                justifyContent: 'center',
                // The focus ring is a colour change on a border that is already
                // there, as on `Field`, so gaining focus never moves the row.
                // `lime[600]` is the ring this world committed and the step
                // `tokens.ts` resolves `ring.light` to; it was `sun[600]`, the
                // partner mark.
                borderWidth: pickerFocused ? 2 : 1,
                borderColor: pickerFocused ? theme.color.lime[600] : theme.color.borderStrong,
                borderRadius: theme.radius.sm,
                paddingHorizontal: theme.space[3] - (pickerFocused ? 1 : 0),
                backgroundColor: pressed ? theme.color.muted : theme.color.background,
              })}
            >
              <Text
                style={{
                  color: theme.color.foreground,
                  fontFamily: face(theme),
                  fontSize: theme.fontSize.base,
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
                onChangeText={(next) => {
                  // Verification persists this phone's token. Lock its identity
                  // even for an edit arriving before the disabled field rerenders.
                  if (submitting.current === 'verify') return;
                  // A revision also rejects an old response after editing A → B → A.
                  revision.current += 1;
                  setPhone(next);
                  setSent(false);
                  setProblem(null);
                  // A code belongs to the number it was sent for, so editing the
                  // number clears it. Unconditional: `filled` is turned off as
                  // soon as the collector types in the code box, and a stale code
                  // must still be cleared after that.
                  setCode('');
                  setFilled(false);
                }}
                keyboardType="phone-pad"
              />
            </View>
          </View>
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

        {country.code === CN.code ? <Note text={tt('signIn.chinaNote')} /> : null}

        {sent ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space[2] }}>
              {/* The note's own padding is 12dp: this drops the mark onto the
                  middle of the sentence's first line rather than its box. */}
              <View style={{ paddingTop: theme.space[2] }}>
                <ZaloMark label={tt('signIn.zaloMark')} />
              </View>
              <View style={{ flexGrow: 1, flexShrink: 1 }}>
                <Note text={tt('signIn.codeSent')} />
              </View>
            </View>
            <Field
              label={tt('signIn.code')}
              value={code}
              onChangeText={(next) => {
                setCode(next);
                setFilled(false);
              }}
              keyboardType="number-pad"
            />
            {filled ? <Note text={tt('signIn.demoFilled')} /> : null}
          </>
        ) : null}

        {problem !== null ? <Note text={tt(problem)} /> : null}

        {/*
          Trúc, in the room the pinned button leaves behind.

          On a 390×844 phone the field ends around a third of the way down and
          the button is at the foot, so without him this screen is a heading, a
          field and four hundred pixels of nothing — which reads as a screen
          that failed to load rather than as one that is waiting for a number.
          The Corner reference fills that space with a keypad; this app cannot,
          because the keypad is the platform's and only appears once the field
          has focus.

          He waves because this is the door. He is tappable and the tap does
          nothing but make him react — that is the whole of the "gamified feel"
          the brief asked for and the reason there are no coins, no XP and no
          streak anywhere in this app. He is inside the flexible gap, so on a
          short phone the gap collapses and he goes with it rather than pushing
          the button off the screen.
        */}
        <View
          style={{
            flexGrow: 1,
            minHeight: theme.space[6],
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Panda
            size={theme.space[20]}
            pose="wave"
            onPress={() => {}}
            label={tt('landing.pandaLabel')}
          />
        </View>

        <View style={{ gap: theme.space[3] }}>
          {sent ? (
            <>
              <Button label={tt('signIn.submit')} disabled={pending} onPress={() => {
                if (submitting.current) return;
                submitting.current = 'verify';
                setProblem(null);
                verify.mutate({ phone: number, code: code.trim(), revision: revision.current });
              }} />
              <Button label={tt('signIn.resendCode')} variant="ghost" disabled={pending} onPress={sendCode} />
            </>
          ) : (
            <Button label={tt('signIn.sendCode')} disabled={pending} onPress={sendCode} />
          )}
          <LegalLine />
        </View>
      </ScrollView>
    </View>
  );
}
