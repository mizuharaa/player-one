import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { USE_MOCK_API } from '../api/config.ts';
import type { MessageKey } from '../i18n.ts';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Body, Button, Card, Field, Hatch, Note, Row, Screen, Title } from '../ui.tsx';

/**
 * APP-14/18: bind by QR or typed serial; list what is bound. The QR path is a
 * demo-only scanner until a real native scanner is linked. Production offers
 * serial entry and explicitly explains the unavailable QR/Bluetooth path.
 */
const MOCK_QR_SERIAL = 'EGO1-PILOT-0007';
const BIND_ERRORS: Record<string, MessageKey> = {
  device_not_found: 'devices.notFound',
  already_bound: 'devices.otherCollector',
  device_not_available: 'devices.retired',
};
const DEVICE_STATES: Record<string, MessageKey> = {
  active: 'devices.active', faulty: 'devices.faulty', retired: 'devices.retired',
};

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
      {devices.isError ? <><Note text={tt(devices.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} /><Button label={tt('common.retry')} disabled={devices.isFetching} onPress={() => void devices.refetch()} /></> : null}
      {devices.isPending ? <Body muted>{tt('common.loading')}</Body> : null}
      {!devices.isError && devices.data !== undefined && devices.data.length === 0 ? (
        <Hatch text={tt('devices.empty')} />
      ) : null}
      {(devices.data ?? []).map((d) => (
        <Card key={d.serial}>
          <Title>{d.serial}</Title>
          <Row label={tt('devices.boundAt')} value={new Date(d.boundAt).toLocaleString()} />
          <Row label={tt('devices.status')} value={tt(DEVICE_STATES[d.status ?? ''] ?? 'devices.unknown')} />
        </Card>
      ))}
      <Card>
        <Title>{tt('devices.bind')}</Title>
        {USE_MOCK_API ? <><Button label={tt('devices.scanQr')} variant="secondary" onPress={() => setSerial(MOCK_QR_SERIAL)} /><Body muted>{tt('devices.qrMock')}</Body></> : <Note text={tt('devices.unavailable')} />}
        <Field label={tt('devices.typed')} value={serial} onChangeText={(value) => { if (!bind.isPending) setSerial(value); }} />
        <Button
          label={tt(bind.isPending ? 'common.saving' : 'devices.bind')}
          disabled={serial.trim() === '' || bind.isPending || devices.isPending || devices.isError}
          onPress={() => bind.mutate(serial.trim())}
        />
        {bind.isError ? <Note text={tt(BIND_ERRORS[bind.error.message] ?? 'devices.bindFailed')} /> : null}
      </Card>
      <Button
        label={tt('devices.provision')}
        variant="secondary"
        disabled={!USE_MOCK_API || devices.isError || (devices.data ?? []).length === 0}
        onPress={() => nav.push({ name: 'provisioning' })}
      />
    </Screen>
  );
}
