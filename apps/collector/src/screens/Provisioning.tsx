import { useNav } from '../nav.tsx';
import { StatePanel } from '../ui/StatePanel.tsx';
import { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useTransport } from '../device/transport-context.tsx';
import type { BleDevice } from '../device/transport.ts';
import { UnavailableDeviceTransport } from '../device/transport.ts';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Field, Row, Screen, Tag, Title } from '../ui.tsx';
import { Icon } from '../ui/Icon.tsx';

type SetupStep = 'scan' | 'connect' | 'send' | 'ip';

/** Scan, connect, configure Wi-Fi, then read IP. Recording stays on the camera. */
export function Provisioning() {
  const transport = useTransport();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const c = theme.collector;
  const [scanned, setScanned] = useState(false);
  const [found, setFound] = useState<BleDevice[]>([]);
  const [connected, setConnected] = useState<string | null>(null);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [ip, setIp] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ step: SetupStep; action: () => Promise<boolean | void> } | null>(null);
  const [pending, setPending] = useState<SetupStep | null>(null);
  const submitting = useRef(false);

  const run = async (step: SetupStep, action: () => Promise<boolean | void>) => {
    if (submitting.current) return;
    submitting.current = true;
    setPending(step);
    setFailure(null);
    try { if (await action() === false) setFailure({ step, action }); }
    catch { setFailure({ step, action }); }
    finally { submitting.current = false; setPending(null); }
  };
  const scan = () => void run('scan', async () => {
    setFound(await transport.scan(5000));
    setScanned(true);
  });

  if (transport instanceof UnavailableDeviceTransport) {
    return <Screen title={tt('prov.title')}>
      <View style={{ paddingVertical: theme.space[6], gap: theme.space[4], alignItems: 'flex-start' }}>
        <Icon name="camera" size={48} color={c.plum} />
        <Title>{tt('state.unavailable')}</Title>
        <Body muted>{tt('devices.unavailable')}</Body>
        <Button label={tt('common.back')} variant="secondary" onPress={() => nav.back()} />
      </View>
    </Screen>;
  }

  const retry = failure === null ? null : <StatePanel error title={tt('prov.failed')} action={tt('common.retry')} onPress={() => void run(failure.step, failure.action)} busy={pending !== null} />;

  return (
    <Screen title={tt('prov.title')}>
      <Body muted>{tt('prov.hint')}</Body>
      <Button label={tt('prov.scan')} onPress={scan} busy={pending === 'scan'} disabled={pending !== null} />
      {failure?.step === 'scan' || failure?.step === 'connect' ? retry : null}
      {scanned && found.length === 0 ? <StatePanel title={tt('state.empty')} text={tt('devices.empty')} action={tt('prov.scan')} onPress={scan} busy={pending !== null} /> : null}
      {found.map((d) => (
        <Pressable
          key={d.deviceAddress}
          accessibilityRole="button"
          accessibilityLabel={d.deviceName}
          accessibilityHint={connected === d.deviceAddress ? tt('prov.connected') : tt('prov.connect')}
          accessibilityState={{ selected: connected === d.deviceAddress, disabled: pending !== null || !d.isConnectable }}
          disabled={pending !== null || !d.isConnectable}
          onPress={() => void run('connect', async () => {
            setConnected(null);
            setSent(false);
            setIp(null);
            await transport.connect(d.deviceAddress);
            setConnected(d.deviceAddress);
          })}
          style={({ pressed }) => ({ paddingVertical: theme.space[4], gap: theme.space[3], borderBottomWidth: 1, borderBottomColor: c.line, opacity: pressed ? 0.7 : 1 })}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
            <Icon name="camera" color={c.plum} size={28} />
            <View style={{ flex: 1, gap: theme.space[1] }}><Title>{d.deviceName}</Title><Body muted>{`${tt('prov.rssi')} ${d.rssi} dBm`}</Body></View>
            {connected === d.deviceAddress ? <Icon name="circleCheck" color={c.plum} /> : <Icon name="chevronRight" color={c.muted} />}
          </View>
          {connected === d.deviceAddress ? <Tag label={tt('prov.connected')} fg={c.plum} bg={c.sun} /> : <Body muted>{tt('prov.connect')}</Body>}
        </Pressable>
      ))}

      {connected !== null ? (
        <View style={{ gap: theme.space[3], paddingTop: theme.space[4] }}>
          <Field label={tt('prov.ssid')} value={ssid} editable={pending === null} onChangeText={(value) => { if (submitting.current) return; setSsid(value); setSent(false); setIp(null); setFailure(null); }} />
          <Field label={tt('prov.password')} value={password} editable={pending === null} onChangeText={(value) => { if (submitting.current) return; setPassword(value); setSent(false); setIp(null); setFailure(null); }} secure />
          <Button
            label={sent ? tt('prov.sent') : tt('prov.send')}
            busy={pending === 'send'}
            disabled={ssid.trim() === '' || pending !== null}
            onPress={() => void run('send', async () => {
              setSent(false);
              setIp(null);
              const result = await transport.configureWifi(ssid, password);
              setSent(result.ok);
              return result.ok;
            })}
          />
          {failure?.step === 'send' ? retry : null}
          <Button
            label={tt('prov.readIp')}
            variant="secondary"
            busy={pending === 'ip'}
            disabled={!sent || pending !== null}
            onPress={() => void run('ip', async () => {
              setIp(null);
              const result = await transport.requestIp();
              if (result.result !== 'success') return false;
              setIp(result.ip);
            })}
          />
          {failure?.step === 'ip' ? retry : null}
          {ip !== null ? <Row label={tt('prov.ip')} value={ip} /> : null}
        </View>
      ) : null}
    </Screen>
  );
}
