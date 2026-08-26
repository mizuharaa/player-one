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
              trackColor={{ false: theme.color.borderStrong, true: theme.color.sun[500] }}
            />
          </View>
        </Card>
      ))}
      {!allChecked ? <Note text={tt('agreements.incomplete')} /> : null}
      <Button label={tt('agreements.submit')} disabled={!allChecked} onPress={() => accept.mutate()} />
    </Screen>
  );
}
