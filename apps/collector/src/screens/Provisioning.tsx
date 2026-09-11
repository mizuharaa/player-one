import { useState } from 'react';
import { useTransport } from '../device/transport-context.tsx';
import type { BleDevice } from '../device/transport.ts';
import { UnavailableDeviceTransport } from '../device/transport.ts';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Button, Card, CardLink, Field, Note, Row, Screen, Tag, Title } from '../ui.tsx';

/**
 * The BLE provisioning flow, in the order the EgoLowBle stack requires:
 * scan → connect → send the phone's Wi-Fi → read back the device IP.
 *
 * The transport behind this screen is the mock; the real one is a Kotlin
 * TurboModule over EgoLowBle-1.1.5.aar and an ARM device (DEVICE_DEPS.md).
 * Nothing on this screen — or anywhere else — starts or stops recording.
 */
export function Provisioning() {
  const transport = useTransport();
  const tt = useT();
  const theme = useTheme();
  const [found, setFound] = useState<BleDevice[]>([]);
  const [connected, setConnected] = useState<string | null>(null);
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [sent, setSent] = useState(false);
  const [ip, setIp] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  if (transport instanceof UnavailableDeviceTransport) {
    return <Screen title={tt('prov.title')}><Note text={tt('devices.unavailable')} /></Screen>;
  }

  return (
    <Screen title={tt('prov.title')}>
      <Body muted>{tt('prov.hint')}</Body>

      <Button label={tt('prov.scan')} onPress={() => void transport.scan(5000).then(setFound)} />
      {found.map((d) => (
        <CardLink
          key={d.deviceAddress}
          label={d.deviceName}
          hint={connected === d.deviceAddress ? tt('prov.connected') : tt('prov.connect')}
          onPress={() =>
            void transport.connect(d.deviceAddress).then(() => setConnected(d.deviceAddress))
          }
        >
          <Title>{d.deviceName}</Title>
          <Row label={tt('prov.rssi')} value={`${d.rssi} dBm`} />
          {connected === d.deviceAddress ? (
            /* Lime, not the pass hue: a connected radio is the machine
               reporting itself and the verdict colours stay on review. Lime is
               this world's one accent — emphasis — and a device that answered
               is the one moment on this screen worth emphasising. Not the ink
               pill, which both buttons below already are: a third ink pill
               here would read as a third action.

               The ink is `stage.ground` and not `limeInk`, which is what
               `Choice` in `ui.tsx` already does for the same fill. `lime[500]`
               is the one accent step that does NOT invert with the scheme, so
               its label cannot either: measured on the rendered pixels,
               `limeInk` reads 4.24:1 on it in light and 1.15:1 in dark —
               `limeInk` is lime *type on the page*, not a label on a lime
               fill, and the token's own comment quotes its ratios against the
               page. The fixed near-black reads 13.94:1 in both schemes.

               It was `tech[100]`, and tech is PaXini's mark now rather than a
               system colour. */
            <Tag
              label={tt('prov.connected')}
              fg={theme.color.stage.ground}
              bg={theme.color.lime[500]}
            />
          ) : (
            <Body muted>{tt('prov.connect')}</Body>
          )}
        </CardLink>
      ))}

      {connected !== null ? (
        <Card>
          <Field label={tt('prov.ssid')} value={ssid} onChangeText={setSsid} />
          <Field label={tt('prov.password')} value={password} onChangeText={setPassword} secure />
          <Button
            label={sent ? tt('prov.sent') : tt('prov.send')}
            disabled={ssid.trim() === ''}
            onPress={() =>
              void transport.configureWifi(ssid, password).then((r) => {
                setSent(r.ok);
                setFailure(r.ok ? null : (r.reason ?? 'failed'));
              })
            }
          />
          <Button
            label={tt('prov.readIp')}
            variant="secondary"
            disabled={!sent}
            onPress={() =>
              void transport.requestIp().then((r) => {
                if (r.result === 'success') {
                  setIp(r.ip);
                  setFailure(null);
                } else {
                  setIp(null);
                  setFailure(r.reason);
                }
              })
            }
          />
          {ip !== null ? <Row label={tt('prov.ip')} value={ip} /> : null}
          {failure !== null ? (
            <Note text={`${tt('prov.failed')}: ${failure}`} />
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}
