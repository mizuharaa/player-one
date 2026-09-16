import { Failure } from '../ui/StatePanel.tsx';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { AGREEMENTS, type AgreementId } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Note, Screen, face } from '../ui.tsx';

/**
 * APP-02: the six agreements, each accepted at the version shown. SPEC.md §6.
 *
 * The submit sends the versions the collector saw — a later revision means a
 * fresh acceptance, never a silent carry-over — and the six ids stay
 * byte-equal to `AGREEMENTS`, which is the server's
 * `collector_agreements_name_check` set. None of that changed here.
 *
 * **The row is the target, not the switch.** 56 pt minimum, the `Pressable`
 * and the `Switch` share one handler, and the 51x31 control is the indicator
 * rather than the thing to hit.
 *
 * **The commit is pinned to the foot of the screen.** At 320x640 six rows plus
 * the intro do not fit, and a commit control a collector has to scroll to hunt
 * for is the shape that produces accidental non-consent. `Screen`'s `footer`
 * measures itself and the list reserves exactly that height.
 *
 * **Not built.** No seventh toggle — APP-02 is exactly these six. **No "accept
 * all" master switch**: one tap granting six separate consents is precisely
 * what the recorded-version-per-acceptance design exists to prevent. No inline
 * document text; a title opens §16's reader when PaXini has supplied the
 * document.
 */
export function Agreements() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const [checked, setChecked] = useState<Partial<Record<AgreementId, boolean>>>({});
  const allChecked = AGREEMENTS.every((a) => checked[a.id] === true);
  const submitting = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const accept = useMutation({
    mutationFn: () =>
      api.acceptAgreements(AGREEMENTS.map((a) => ({ agreementId: a.id, version: a.version }))),
    onSuccess: () => { if (mounted.current) nav.push({ name: 'exam' }); },
    onSettled: () => { submitting.current = false; },
  });

  const submit = () => {
    // Native events can arrive before React renders the disabled controls.
    if (!mounted.current || submitting.current || !allChecked) return;
    submitting.current = true;
    accept.mutate();
  };

  const toggle = (id: AgreementId, next: boolean) => {
    if (submitting.current || accept.isPending) return;
    setChecked((c) => ({ ...c, [id]: next }));
  };

  return (
    <Screen
      title={tt('agreements.title')}
      footer={
        <>
          {!allChecked ? <Note text={tt('agreements.incomplete')} /> : null}
          {accept.isError ? <Failure onRetry={submit} busy={accept.isPending} error={accept.error} text={tt('common.actionFailed')} /> : null}
          <Button
            label={tt(accept.isPending ? 'common.saving' : accept.isError ? 'common.retry' : 'agreements.submit')}
            disabled={!allChecked || accept.isPending}
            onPress={submit}
          />
        </>
      }
    >
      <Body muted>{tt('agreements.intro')}</Body>
      {AGREEMENTS.map((a) => {
        const on = checked[a.id] === true;
        return (
          <Pressable
            key={a.id}
            accessibilityRole="switch"
            accessibilityState={{ checked: on, disabled: accept.isPending }}
            accessibilityLabel={tt(`agreement.${a.id}`)}
            onPress={() => toggle(a.id, !on)}
            disabled={accept.isPending}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              // `minHeight`, never `height`: at fontScale 1.3 a two-line
              // document title has to grow the row rather than be clipped by it.
              minHeight: theme.space[12] + theme.space[2],
              padding: theme.space[4],
              borderRadius: theme.radius.lg,
              borderWidth: 1,
              borderColor: theme.color.border,
              backgroundColor: pressed ? theme.color.muted : theme.color.surface,
            })}
          >
            <View style={{ flex: 1, gap: theme.space[1] }}>
              <Text
                style={{
                  color: theme.color.foreground,
                  fontFamily: face(theme),
                  fontSize: theme.fontSize.base,
                  lineHeight: Math.round(theme.fontSize.base * 1.45),
                }}
              >
                {tt(`agreement.${a.id}`)}
              </Text>
              <Text
                style={{
                  color: theme.color.mutedForeground,
                  fontFamily: face(theme),
                  fontSize: theme.fontSize.xs,
                  lineHeight: Math.round(theme.fontSize.xs * 1.4),
                }}
              >
                {tt('agreements.version')} {a.version}
              </Text>
            </View>
            <Switch
              accessibilityLabel={tt(`agreement.${a.id}`)}
              // The row above is the one accessibility stop; this is its
              // indicator and announcing it twice is two stops for one act.
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              disabled={accept.isPending}
              value={on}
              onValueChange={(v) => toggle(a.id, v)}
              thumbColor={theme.color.surface}
              /* On is the ink pill, the same mark `Chip` and `Button` carry:
                 the control's selected state is where the collector's action
                 is. Off is `fieldBorder`, the one border token this system
                 holds to a ratio — `borderStrong` measured 1.64:1 against the
                 card, under WCAG 1.4.11's 3:1 for the boundary that identifies
                 a control. A switch nobody can see off is a switch nobody
                 knows is there. */
              trackColor={{ false: theme.color.fieldBorder, true: theme.color.action }}
            />
          </Pressable>
        );
      })}
    </Screen>
  );
}
