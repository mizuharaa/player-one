/**
 * Path A: pulling recorded episodes off the device over the LAN, once
 * provisioning has yielded a device IP.
 *
 * ponytail: mock only — the real file-offload protocol is an open PaXini
 * question (owed alongside D1/D5); do NOT invent it. This interface is the
 * seam the answer plugs into.
 *
 * Deliberately absent, forever: any method that deletes, clears or formats
 * anything on the device. No code path ever deletes TF-card source media and
 * no TF card is ever cleared (brief rule 6, non-deviable half).
 */

export interface DeviceEpisode {
  episodeId: string;
  files: { path: string; sizeBytes: number }[];
}

export interface DeviceTransfer {
  listEpisodes(deviceIp: string): Promise<DeviceEpisode[]>;
  /** Copies one episode to phone storage. Copy — the source stays on the card. */
  pull(deviceIp: string, episodeId: string): Promise<{ copiedBytes: number }>;
}

export class MockDeviceTransfer implements DeviceTransfer {
  async listEpisodes(_deviceIp: string): Promise<DeviceEpisode[]> {
    return [
      {
        episodeId: 'ego1-20260825-1010',
        files: [
          { path: 'camera_01.mp4', sizeBytes: 1_572_864_000 },
          { path: 'imu.csv', sizeBytes: 44_040_192 },
          { path: 'audio.wav', sizeBytes: 220_200_960 },
        ],
      },
    ];
  }

  async pull(deviceIp: string, episodeId: string): Promise<{ copiedBytes: number }> {
    const episodes = await this.listEpisodes(deviceIp);
    const episode = episodes.find((e) => e.episodeId === episodeId);
    if (episode === undefined) throw new Error('episode_not_on_device');
    return { copiedBytes: episode.files.reduce((sum, f) => sum + f.sizeBytes, 0) };
  }
}
