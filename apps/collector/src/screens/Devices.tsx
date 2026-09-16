import { Failure } from '../ui/StatePanel.tsx';
import { useState, type ComponentType } from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { USE_MOCK_API } from '../api/config.ts';
import type { MessageKey } from '../i18n.ts';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Card, Field, Hatch, Loading, Note, Row, Screen, Title, face } from '../ui.tsx';
import { HowCharge, HowHandOver, HowPressDevice, HowWear } from '../ui/illustrations/index.tsx';

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
  const theme = useTheme();
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
      {devices.isError ? <Failure error={devices.error} text={tt(devices.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} onRetry={() => void devices.refetch()} busy={devices.isFetching} /> : null}
      {devices.isPending ? <Loading /> : null}
      {!devices.isError && devices.data !== undefined && devices.data.length === 0 ? (
        <Hatch action={tt('common.retry')} onPress={() => void devices.refetch()} text={tt('devices.empty')} />
      ) : null}
      {(devices.data ?? []).map((d) => (
        <Card key={d.serial}>
          {/* The serial in tech blue, which §2 reserves for a device serial,
              a session id and nothing else. Tabular figures, because a
              collector reads this off the camera character by character. */}
          <Text
            style={{
              ...theme.collector.type.h2,
              color: theme.collector.techInk,
              fontFamily: face(theme),
              fontVariant: ['tabular-nums'],
            }}
          >
            {d.serial}
          </Text>
          <Row label={tt('devices.boundAt')} value={new Date(d.boundAt).toLocaleString()} />
          <Row label={tt('devices.status')} value={tt(DEVICE_STATES[d.status ?? ''] ?? 'devices.unknown')} />
          {/* Battery and last-used are what a collector wants on this card and
              `BoundDevice` carries neither — it is `{ serial, boundAt, status }`
              and nothing else. So the rows exist and say "not reported": the
              field is a real property of the camera, the server does not send
              it, and an empty gauge or a guessed percentage would be this app
              inventing a reading. When the device record grows the columns,
              these two rows read them and the sentence below goes. */}
          <Row label={tt('devices.battery')} value={tt('devices.notReported')} />
          <Row label={tt('devices.lastUsed')} value={tt('devices.notReported')} />
          <Body muted>{tt('devices.noReadings')}</Body>
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
        {bind.isError ? <Failure onRetry={() => bind.mutate(serial.trim())} busy={bind.isPending} error={bind.error} text={tt(BIND_ERRORS[bind.error.message] ?? 'devices.bindFailed')} /> : null}
      </Card>
      <Button
        label={tt('devices.provision')}
        variant="secondary"
        disabled={!USE_MOCK_API || devices.isError || (devices.data ?? []).length === 0}
        onPress={() => nav.push({ name: 'provisioning' })}
      />

      <HowToRecord />
    </Screen>
  );
}

/**
 * Work order §4.12 — how to use the Ego, in four illustrated steps.
 *
 * The framing is klarna-070/072: one drawing, a numbered heading, one
 * sentence. The drawings are this lane's own family (plum fill, sun accent,
 * one ink stroke), so they sit beside the onboarding cards rather than beside
 * clip art.
 *
 * **Step three is the one that matters.** Only the camera's own buttons start
 * and stop a recording, and the copy says the app cannot do it and never will.
 * That is the rule most likely to be designed away by somebody adding a
 * "Start" button here, so it is written on the screen a collector reads before
 * their first session.
 */
const STEPS: readonly { key: MessageKey; body: MessageKey; Art: ComponentType<{ size?: number }> }[] = [
  { key: 'devices.step1', body: 'devices.step1Body', Art: HowCharge },
  { key: 'devices.step2', body: 'devices.step2Body', Art: HowWear },
  { key: 'devices.step3', body: 'devices.step3Body', Art: HowPressDevice },
  { key: 'devices.step4', body: 'devices.step4Body', Art: HowHandOver },
];

function HowToRecord() {
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  const { width, fontScale } = useWindowDimensions();
  /**
   * The drawing gives up room before the words do.
   *
   * At 320dp and 1.3x text a fixed 96dp square pushed the sentence to five
   * lines and the step below it off the fold; the art shrinks instead.
   */
  const art = Math.min(width * 0.22, fontScale > 1.15 ? 64 : 96);
  const stacked = width <= 320 || fontScale > 1.2;

  return (
    <View style={{ gap: theme.space[3], marginTop: c.sectionGap }}>
      <Text
        accessibilityRole="header"
        style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2 }}
      >
        {tt('devices.howTitle')}
      </Text>
      {STEPS.map(({ key, body, Art }, index) => (
        <View
          key={key}
          style={{
            flexDirection: stacked ? 'column' : 'row',
            alignItems: stacked ? 'flex-start' : 'center',
            gap: theme.space[3],
            paddingVertical: theme.space[3],
            borderBottomWidth: index === STEPS.length - 1 ? 0 : 1,
            borderBottomColor: c.line,
          }}
        >
          <Art size={art} />
          <View style={{ flex: stacked ? undefined : 1, gap: theme.space[1] }}>
            <Text
              style={{
                ...c.type.body,
                color: c.ink,
                fontFamily: face(theme),
                fontWeight: theme.fontWeight.semibold,
              }}
            >
              {`${index + 1}. ${tt(key)}`}
            </Text>
            <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{tt(body)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}
