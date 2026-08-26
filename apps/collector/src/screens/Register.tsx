import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Body, Button, Card, Field, Note, Screen } from '../ui.tsx';

/** APP-01: register an account. Agreements follow immediately (APP-02). */
export function Register() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [missing, setMissing] = useState(false);

  const register = useMutation({
    mutationFn: () => api.register(name, phone),
    onSuccess: () => nav.push({ name: 'agreements' }),
    onError: () => setMissing(true),
  });

  return (
    <Screen title={tt('register.title')}>
      <Body muted>{tt('register.intro')}</Body>
      <Card>
        <Field label={tt('register.name')} value={name} onChangeText={setName} />
        <Field label={tt('register.phone')} value={phone} onChangeText={setPhone} />
        {missing ? <Note text={tt('register.missing')} /> : null}
        <Button label={tt('register.submit')} onPress={() => register.mutate()} />
      </Card>
    </Screen>
  );
}
