import { statfs } from 'node:fs/promises';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { schema, type Db } from '@playerone/store';

/** What the sender needs of an app: Fastify's `inject`, and a test's fake. */
export type HeartbeatApp = {
  inject(o: {
    method: string;
    url: string;
    headers?: Record<string, string>;
    payload?: unknown;
  }): Promise<{ statusCode: number; json(): unknown }>;
};

export type HeartbeatConfig = {
  machineIdentifier: string;
  secret: string;
  mediaRoot: string;
  intervalMs?: number;
};

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * One sender. The returned function is one beat; the token and the resolved
 * device id live in its closure. A plain `sendHeartbeat(app, db, cfg)` would
 * have nowhere to keep either between beats and would sign in and resolve the
 * same machine every minute.
 *
 * Every failure becomes `false`, including a failed status POST. A missed beat
 * is the signal condition 3 exists to expose; throwing out of a timer would
 * take down the API process whose health the beat is meant to report.
 */
export function heartbeatSender(
  app: HeartbeatApp,
  db: Db,
  cfg: HeartbeatConfig,
): () => Promise<boolean> {
  let token: string | undefined;
  let deviceId: string | undefined;

  const warn = (message: string): false => {
    console.warn(`[upload-centre heartbeat] ${message}`);
    return false;
  };

  const resolveDevice = async (): Promise<string | undefined> => {
    if (deviceId !== undefined) return deviceId;
    const [row] = await db
      .select({ id: schema.uploadDevices.id })
      .from(schema.uploadDevices)
      .where(eq(schema.uploadDevices.machineIdentifier, cfg.machineIdentifier))
      .limit(1);
    if (row === undefined) {
      warn(`machine ${cfg.machineIdentifier} has no upload_devices row`);
      return undefined;
    }
    deviceId = row.id;
    return deviceId;
  };

  const signIn = async (): Promise<string | undefined> => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/machine',
      payload: { machine_identifier: cfg.machineIdentifier, secret: cfg.secret },
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      token = undefined;
      warn(`machine sign-in answered ${response.statusCode}`);
      return undefined;
    }
    const body = response.json() as { token?: unknown };
    if (typeof body.token !== 'string' || body.token === '') {
      token = undefined;
      warn('machine sign-in returned no token');
      return undefined;
    }
    token = body.token;
    return token;
  };

  const measurements = async (uploadDeviceId: string) => {
    const filesystem = await statfs(cfg.mediaRoot);
    /**
     * These are cards imported, or still importing, whose cloud leg has not
     * finished. `verified`, `closed` and `failed` batches are not waiting to be
     * delivered and therefore are not a queue backlog.
     *
     * // ponytail: the API process is the centre client today and can count its
     * database queue; the Electron client will count its own local queue and
     * post the same field through this route when it replaces this process.
     */
    const [queue] = await db
      .select({ depth: sql<number>`count(*)::int` })
      .from(schema.uploadBatches)
      .where(
        and(
          eq(schema.uploadBatches.uploadDeviceId, uploadDeviceId),
          inArray(schema.uploadBatches.batchStatus, [
            'importing',
            'imported',
            'uploading',
            'verifying',
          ]),
        ),
      );
    return {
      disk_free_bytes: filesystem.bavail * filesystem.bsize,
      queue_depth: Number(queue?.depth ?? 0),
    };
  };

  return async () => {
    try {
      const resolvedDeviceId = await resolveDevice();
      if (resolvedDeviceId === undefined) return false;

      let machineToken = token ?? (await signIn());
      if (machineToken === undefined) return false;
      const payload = await measurements(resolvedDeviceId);
      const post = (currentToken: string) =>
        app.inject({
          method: 'POST',
          url: `/upload-devices/${resolvedDeviceId}/heartbeat`,
          headers: { 'x-machine-token': `Bearer ${currentToken}` },
          payload,
        });

      let response = await post(machineToken);
      if (response.statusCode === 401) {
        token = undefined;
        // ponytail: one re-login is the whole retry policy; a flapping link is
        // deliberately visible as a missed beat, and condition 3 reports it.
        machineToken = await signIn();
        if (machineToken === undefined) return false;
        response = await post(machineToken);
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        return warn(`status POST answered ${response.statusCode}`);
      }
      return true;
    } catch (err) {
      return warn(`not sent: ${err instanceof Error ? err.message : String(err)}`);
    }
  };
}

/**
 * Starts one sender. It beats once now, then once per interval, and its timer
 * cannot keep an otherwise-finished process alive. The caller owns the returned
 * stop function so shutdown can prevent another beat before closing the pool.
 */
export function startHeartbeat(
  app: HeartbeatApp,
  db: Db,
  cfg: HeartbeatConfig,
): () => void {
  const beat = heartbeatSender(app, db, cfg);
  void beat();
  const timer = setInterval(() => void beat(), cfg.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
