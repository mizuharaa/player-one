/**
 * BLE provisioning seam, shaped 1:1 on PaXini's EgoLowBle Android surface
 * (`EgoLowBleNative.kt` in the SDK kit): scan → connect → configureWifi(ssid,
 * password) → requestIp. See `apps/collector/DEVICE_DEPS.md` for the real
 * artifact and its hash.
 *
 * ponytail: mock transport only — the real EgoLowBle module needs a Kotlin
 * TurboModule around EgoLowBle-1.1.5.aar and an ARM test device; wire it in
 * when the device exists, behind this same interface.
 *
 * HARD RULE (brief, restated): the app must NEVER start or stop recording.
 * This interface has no such method and must never grow one — recording is
 * controlled on the device itself, by the collector's hands.
 */

/** Mirrors EgoLowBleScanDevice. */
export interface BleDevice {
  deviceName: string;
  deviceAddress: string;
  rssi: number;
  isConnectable: boolean;
}

/** Mirrors EgoLowBleIpResponse's result codes. */
export type IpResult =
  | { result: 'success'; ip: string }
  | { result: 'not_configured' | 'configuring' | 'configure_failed'; reason: string };

export interface DeviceTransport {
  scan(timeoutMs: number): Promise<BleDevice[]>;
  connect(deviceAddress: string): Promise<void>;
  /** The phone's Wi-Fi credentials, typed by the collector, sent to the device. */
  configureWifi(ssid: string, password: string): Promise<{ ok: boolean; reason?: string }>;
  /** The device answers with the IP it obtained on that Wi-Fi. */
  requestIp(): Promise<IpResult>;
  disconnect(): Promise<void>;
}

export class TransportError extends Error {
  constructor(readonly code: 'not_connected' | 'device_not_found') {
    super(code);
  }
}

/** One fake Ego on the bench. Enforces the same call order the real BLE stack does. */
export class MockDeviceTransport implements DeviceTransport {
  private connected: string | null = null;
  private wifiConfigured = false;

  async scan(_timeoutMs: number): Promise<BleDevice[]> {
    return [
      { deviceName: 'Ego-A1B2C3', deviceAddress: 'DC:0D:30:A1:B2:C3', rssi: -48, isConnectable: true },
      { deviceName: 'Ego-9F8E7D', deviceAddress: 'DC:0D:30:9F:8E:7D', rssi: -71, isConnectable: true },
    ];
  }

  async connect(deviceAddress: string): Promise<void> {
    const known = await this.scan(0);
    if (!known.some((d) => d.deviceAddress === deviceAddress)) {
      throw new TransportError('device_not_found');
    }
    this.connected = deviceAddress;
    this.wifiConfigured = false;
  }

  async configureWifi(ssid: string, _password: string): Promise<{ ok: boolean; reason?: string }> {
    if (this.connected === null) throw new TransportError('not_connected');
    if (ssid.trim() === '') return { ok: false, reason: 'empty_ssid' };
    this.wifiConfigured = true;
    return { ok: true };
  }

  async requestIp(): Promise<IpResult> {
    if (this.connected === null) throw new TransportError('not_connected');
    if (!this.wifiConfigured) return { result: 'not_configured', reason: 'wifi not configured' };
    return { result: 'success', ip: '192.168.1.83' };
  }

  async disconnect(): Promise<void> {
    this.connected = null;
    this.wifiConfigured = false;
  }
}
