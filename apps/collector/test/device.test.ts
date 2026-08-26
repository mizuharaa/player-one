import { describe, expect, it } from 'vitest';
import { MockDeviceTransport } from '../src/device/transport.ts';
import { MockDeviceTransfer } from '../src/device/transfer.ts';

/**
 * The two device seams. The mocks enforce the order the real BLE stack does,
 * so a screen that works against them is not lying about the happy path.
 */
describe('BLE provisioning transport (mocked EgoLowBle)', () => {
  it('walks scan → connect → configureWifi → requestIp and yields an IP', async () => {
    const transport = new MockDeviceTransport();
    const found = await transport.scan(5000);
    expect(found.length).toBeGreaterThan(1);

    const first = found[0]!;
    await transport.connect(first.deviceAddress);

    // Asking for the IP before Wi-Fi is configured mirrors the SDK's
    // IP_RESULT_NOT_CONFIGURED, not an exception.
    const early = await transport.requestIp();
    expect(early.result).toBe('not_configured');

    const config = await transport.configureWifi('VNG-Guest', 'hunter2');
    expect(config.ok).toBe(true);

    const ip = await transport.requestIp();
    expect(ip).toEqual({ result: 'success', ip: '192.168.1.83' });
  });

  it('refuses configuration when not connected, like the real stack', async () => {
    const transport = new MockDeviceTransport();
    await expect(transport.configureWifi('VNG-Guest', 'x')).rejects.toThrow('not_connected');
    await expect(transport.connect('00:00:00:00:00:00')).rejects.toThrow('device_not_found');
  });

  it('drops the Wi-Fi state on reconnect', async () => {
    const transport = new MockDeviceTransport();
    const [a, b] = await transport.scan(0);
    await transport.connect(a!.deviceAddress);
    await transport.configureWifi('VNG-Guest', 'x');
    await transport.connect(b!.deviceAddress);
    expect((await transport.requestIp()).result).toBe('not_configured');
  });
});

describe('Path A transfer (mocked; real protocol is an open PaXini question)', () => {
  it('lists episodes on the device and pulls a copy', async () => {
    const transfer = new MockDeviceTransfer();
    const episodes = await transfer.listEpisodes('192.168.1.83');
    expect(episodes.length).toBeGreaterThan(0);
    const pulled = await transfer.pull('192.168.1.83', episodes[0]!.episodeId);
    expect(pulled.copiedBytes).toBe(
      episodes[0]!.files.reduce((sum, f) => sum + f.sizeBytes, 0),
    );
    await expect(transfer.pull('192.168.1.83', 'nope')).rejects.toThrow('episode_not_on_device');
  });
});

describe('the hard rules, pinned on the seams', () => {
  it('exposes no recording control and no way to delete source media', async () => {
    // The brief's most tempting violation: the app must NEVER start or stop
    // recording. And rule 6's non-deviable half: no code path deletes TF-card
    // media, no TF card is ever cleared. If either verb grows on a device
    // seam, this fails before a reviewer has to catch it.
    const transport = new MockDeviceTransport();
    const transfer = new MockDeviceTransfer();
    for (const instance of [transport, transfer]) {
      const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(instance));
      for (const method of methods) {
        expect(method).not.toMatch(/record|capture|start|stop/i);
        expect(method).not.toMatch(/delete|clear|erase|format|remove|wipe/i);
      }
    }
  });
});
