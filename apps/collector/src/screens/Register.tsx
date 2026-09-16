import { Failure } from '../ui/StatePanel.tsx';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Field, Note, Screen, Tag, face } from '../ui.tsx';

/**
 * APP-01's profile, for a collector whose account exists but whose name has
 * not been recorded. SPEC.md §5. Two fields, and only one of them is a
 * question.
 *
 * **One question per screen.** The reference pass is near-unanimous that a
 * signup step asks one thing, and that a step which must show two inputs
 * groups them into a single visual object. The phone is not a second question
 * here — the collector verified it thirty seconds ago on §4 — so it is shown
 * as context on a `discover.soft` fill with the word "verified" beside it, and
 * the name is the one editable field, directly beneath it in the same
 * container. It is still **sent** to `api.register`, unchanged.
 *
 * **Where the number comes from.** `GET /api/me/profile`, which already
 * carries it: this route is reached when the profile has no name, not when
 * there is no session. If the profile is genuinely absent — the one case
 * `sessionEntry` also routes here — there is no verified number to show and
 * the field is editable, because the request needs a phone and the app must
 * not send an empty one. That branch is three lines and it is the difference
 * between a form that works and one that posts nothing.
 *
 * `register.missing` is validated on submit and not on blur, so the field does
 * not turn red while the collector is still typing in it.
 *
 * **Not built.** No email, date of birth, address, ID upload, avatar, gender
 * or referral code. The server takes a name and a phone.
 */
export function Register() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const verified = profile.data?.phone ?? '';
  const [name, setName] = useState('');
  const [typedPhone, setTypedPhone] = useState('');
  const [missing, setMissing] = useState(false);
  const phone = verified === '' ? typedPhone : verified;

  const register = useMutation({
    mutationFn: () => api.register(name, phone),
    onSuccess: () => nav.push({ name: 'agreements' }),
  });

  return (
    <Screen title={tt('register.title')}>
      <Body muted>{tt('register.intro')}</Body>

      {/* One grouped object, not two fields: the pair is the control. */}
      <View
        style={{
          borderRadius: theme.radius.lg,
          borderWidth: 1,
          borderColor: theme.color.border,
          backgroundColor: theme.color.surface,
          padding: theme.space[4],
          gap: theme.space[3],
        }}
      >
        {verified === '' ? (
          <Field
            label={tt('register.phone')}
            value={typedPhone}
            onChangeText={setTypedPhone}
            keyboardType="phone-pad"
          />
        ) : (
          <View style={{ gap: theme.space[1] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space[2] }}>
              <Text
                style={{
                  color: theme.color.mutedForeground,
                  fontFamily: face(theme),
                  fontSize: theme.fontSize.sm,
                }}
              >
                {tt('register.phone')}
              </Text>
              {/*
                Never colour alone: the pill carries a glyph as well as its
                word, the same rule the verdict pills on §13 follow, and the
                word is the whole signal on its own.
              */}
              <Tag
                label={tt('register.phoneVerified')}
                fg={theme.color.verdict.pass.fg}
                bg={theme.color.verdict.pass.bg}
                mark="✓"
              />
            </View>
            <View
              style={{
                backgroundColor: theme.color.muted,
                borderRadius: theme.radius.base,
                paddingVertical: theme.space[3],
                paddingHorizontal: theme.space[3],
                minHeight: theme.space[12],
                justifyContent: 'center',
              }}
            >
              <Text
                accessibilityLabel={`${tt('register.phone')}: ${phone}`}
                style={{
                  color: theme.color.foreground,
                  fontFamily: face(theme),
                  fontSize: theme.fontSize.base,
                  fontWeight: theme.fontWeight.medium,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {phone}
              </Text>
            </View>
            <Text
              style={{
                color: theme.color.mutedForeground,
                fontFamily: face(theme),
                fontSize: theme.fontSize.sm,
                lineHeight: Math.round(theme.fontSize.sm * 1.4),
              }}
            >
              {tt('register.phoneLocked')}
            </Text>
          </View>
        )}

        <Field label={tt('register.name')} value={name} onChangeText={setName} />
      </View>

      {missing ? <Note text={tt('register.missing')} /> : null}
      {register.isError ? <Failure error={register.error} text={tt('common.actionFailed')} /> : null}
      <Button
        disabled={register.isPending}
        label={tt(register.isPending ? 'common.saving' : 'register.submit')}
        onPress={() => {
          const incomplete = name.trim() === '' || phone.trim() === '';
          setMissing(incomplete);
          if (!incomplete) register.mutate();
        }}
      />
    </Screen>
  );
}
