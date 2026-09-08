import { useState } from 'react';
import { Switch, View } from 'react-native';
import { useMutation } from '@tanstack/react-query';
import { AGREEMENTS, type AgreementId } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Card, Note, Screen, Title } from '../ui.tsx';

/**
 * APP-02: the six agreements, each accepted at the version shown. The submit
 * sends the versions the collector saw — a later revision means a fresh
 * acceptance, never a silent carry-over.
 */
export function Agreements() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const [checked, setChecked] = useState<Partial<Record<AgreementId, boolean>>>({});
  const allChecked = AGREEMENTS.every((a) => checked[a.id] === true);

  const accept = useMutation({
    mutationFn: () =>
      api.acceptAgreements(AGREEMENTS.map((a) => ({ agreementId: a.id, version: a.version }))),
    onSuccess: () => nav.push({ name: 'training' }),
  });

  return (
    <Screen title={tt('agreements.title')}>
      <Body muted>{tt('agreements.intro')}</Body>
      {AGREEMENTS.map((a) => (
        <Card key={a.id}>
          <View
            style={{
              flexDirection: 'row',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: theme.space[3],
            }}
          >
            <View style={{ flexShrink: 1, gap: theme.space[1] }}>
              <Title>{tt(`agreement.${a.id}`)}</Title>
              <Body muted>
                {tt('agreements.version')} {a.version}
              </Body>
            </View>
            <Switch
              accessibilityLabel={tt(`agreement.${a.id}`)}
              value={checked[a.id] === true}
              onValueChange={(v) => setChecked((c) => ({ ...c, [a.id]: v }))}
              thumbColor={theme.color.background}
              /* On is the ink pill, the same mark `Chip` and `Button` carry:
                 the control's selected state is where the collector's action
                 is, and sun is the VNG mark now rather than an action colour.
                 Off is `fieldBorder`, the one border token this system holds
                 to a ratio. Measured off the rendered pixels, on the card this
                 switch sits on: `borderStrong` read 1.64:1 in light and 1.67:1
                 in dark, both under WCAG 1.4.11's 3:1 for the boundary that
                 identifies a control; `fieldBorder` reads 3.83:1 and 3.94:1. A
                 switch nobody can see off is a switch nobody knows is there. */
              trackColor={{ false: theme.color.fieldBorder, true: theme.color.action }}
            />
          </View>
        </Card>
      ))}
      {!allChecked ? <Note text={tt('agreements.incomplete')} /> : null}
      <Button label={tt('agreements.submit')} disabled={!allChecked} onPress={() => accept.mutate()} />
    </Screen>
  );
}
