import type { Db } from '@playerone/store';
import { readAlerts, type Alert, type AlertState } from './alerts.ts';

export type AlertNotice = {
  id: string;
  state: 'firing' | 'cleared';
  observed: number | null;
  threshold: number | null;
  text: string;
};

const descriptions: Record<string, string> = {
  upload_failures: 'collector uploads failed without a verified retry',
  devices_offline: 'bound devices have produced nothing for a week',
  upload_centres_offline_or_backlogged: 'upload devices are offline or backlogged',
  upload_devices_low_disk: 'upload devices have less than 50 GB free',
  card_import_failures: 'card imports failed in the last 24 hours',
  cloud_write_failures: 'cloud transports failed in the last 24 hours',
  archive_tag_failures: 'recorded archive tagging operations failed in the last 24 hours (not unresolved objects)',
  checksum_failures: 'episodes failed read-back',
  storage_near_quota: 'GB of verified source bytes in the cloud (threshold is 80% of the allocation)',
};

export function noticesFor(last: Map<string, AlertState>, next: Alert[]): AlertNotice[] {
  const notices: AlertNotice[] = [];
  for (const alert of next) {
    const previous = last.get(alert.id);
    const state = alert.state === 'firing' && previous !== 'firing' ? 'firing'
      : alert.state === 'ok' && previous === 'firing' ? 'cleared' : undefined;
    if (state === undefined) continue;
    const { id, observed, threshold } = alert;
    notices.push({
      id, state, observed, threshold,
      text: `${id} ${state}: ${observed} ${descriptions[id] ?? 'offending observations'} (threshold ${threshold}).`,
    });
  }
  return notices;
}

// ponytail: at-least-once delivery can repeat a POST whose response was lost;
// a duplicate operational sentence is cheaper than an acknowledgement protocol.
// The ceiling that cannot be fixed from this side: a request we abort at the
// timeout may still complete at the receiver afterwards, so a later notice that
// landed first can be overwritten by an earlier one. Ordering is the receiver's
// to enforce, which is why every payload carries `at`. Anything stronger needs
// the receiver to cooperate, and a generic webhook does not.
export async function post(notice: AlertNotice, log: (line: string) => void = console.log): Promise<void> {
  const url = process.env['PLAYERONE_ALERT_WEBHOOK'];
  if (!url) {
    log(notice.text);
    return;
  }
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...notice, at: new Date().toISOString() }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`alert webhook returned HTTP ${response.status}`);
}

type DeliveryOptions = {
  storageQuotaBytes?: number;
  last: Map<string, AlertState>;
  pending: Map<string, AlertNotice>;
  post?: (n: AlertNotice) => Promise<void>;
  log?: (line: string) => void;
};

export async function deliverAlerts(
  db: Db,
  o: DeliveryOptions,
): Promise<{ delivered: AlertNotice[]; failed: AlertNotice[] }> {
  const alerts = await readAlerts(db, { storageQuotaBytes: o.storageQuotaBytes });
  const notices = noticesFor(o.last, alerts);
  for (const alert of alerts) o.last.set(alert.id, alert.state);
  for (const notice of notices) o.pending.set(notice.id, notice);
  const delivered: AlertNotice[] = [];
  const failed: AlertNotice[] = [];
  const send = o.post ?? ((notice: AlertNotice) => post(notice, o.log));
  // Only the newest notice per condition is ever sent, and it is retried until it
  // lands. There is deliberately no "we already told them that" suppression: a
  // send that throws may still have reached the receiver, so what the operator
  // last saw is never known, and suppressing against a guess is how they end up
  // stranded on `cleared` while the condition is still firing. Sending one extra
  // sentence is the cheaper wrong answer.
  for (const [id, notice] of o.pending) {
    try {
      await send(notice);
      o.pending.delete(id);
      delivered.push(notice);
    } catch {
      failed.push(notice);
    }
  }
  return { delivered, failed };
}

export function runAlertWorker(
  db: Db,
  o: Omit<DeliveryOptions, 'last' | 'pending'> & {
    intervalMs?: number;
    onError?: (err: unknown) => void;
  } = {},
): { stop: () => void } {
  const intervalMs = o.intervalMs ?? 60_000;
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) throw new Error('alert worker interval must be positive');
  // ponytail: state is in memory, so a restart re-notifies whatever is still
  // firing once and drops anything pending. Acceptable for twenty devices and
  // one operator; add a table when the pilot says duplicates are noise.
  const last = new Map<string, AlertState>();
  const pending = new Map<string, AlertNotice>();
  let running = false;
  const once = async () => {
    if (running) return;
    running = true;
    try {
      const report = await deliverAlerts(db, { ...o, last, pending });
      (o.log ?? console.log)(`alerts delivered ${report.delivered.length}, failed ${report.failed.length}`);
    } catch (err) {
      (o.onError ?? console.error)(err);
    } finally {
      running = false;
    }
  };
  const handle = setInterval(() => void once(), intervalMs);
  void once();
  return { stop: () => clearInterval(handle) };
}
