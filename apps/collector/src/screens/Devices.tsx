import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Body, Button, Card, Field, Note, Row, Screen, Title } from '../ui.tsx';

/**
 * APP-14/18: bind by QR or typed serial; list what is bound. The QR path is a
 * mock scanner until the device work starts — VisionCamera needs a build with
 * native modules, which this machine cannot produce.
 */
const MOCK_QR_SERIAL = 'EGO1-PILOT-0007';

export function Devices() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const queryClient = useQueryClient();
  const [serial, setSerial] = useState('');

  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.boundDevices() });

  const bind = useMutation({
    mutationFn: (s: string) => api.bindDevice(s),
    onSuccess: async () => {
      setSerial('');
      await queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
  });

  return (
    <Screen title={tt('devices.title')}>
      {devices.data !== undefined && devices.data.length === 0 ? (
        <Body muted>{tt('devices.empty')}</Body>
      ) : null}
      {(devices.data ?? []).map((d) => (
        <Card key={d.serial}>
          <Title>{d.serial}</Title>
          <Row label={tt('devices.boundAt')} value={new Date(d.boundAt).toLocaleString()} />
        </Card>
      ))}
      <Card>
        <Button label={tt('devices.scanQr')} kind="ghost" onPress={() => setSerial(MOCK_QR_SERIAL)} />
        <Body muted>{tt('devices.qrMock')}</Body>
        <Field label={tt('devices.typed')} value={serial} onChangeText={setSerial} />
        <Button
          label={tt('devices.bind')}
          disabled={serial.trim() === ''}
          onPress={() => bind.mutate(serial)}
        />
        {bind.isError ? <Note text={String((bind.error as Error).message)} /> : null}
      </Card>
      <Button
        label={tt('devices.provision')}
        kind="ghost"
        disabled={(devices.data ?? []).length === 0}
        onPress={() => nav.push({ name: 'provisioning' })}
      />
    </Screen>
  );
}
