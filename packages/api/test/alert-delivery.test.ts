import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '@playerone/store';
import { storageQuotaFromEnv, type Alert, type AlertState } from '../src/alerts.ts';
import { deliverAlerts, noticesFor, post, runAlertWorker, type AlertNotice } from '../src/alert-delivery.ts';

const alert = (state: AlertState, id = 'checksum_failures'): Alert => ({
  id, state, observed: state === 'no_signal' ? null : state === 'firing' ? 2 : 0,
  threshold: state === 'no_signal' ? null : 1,
});
const database = (execute: ReturnType<typeof vi.fn>): Db => ({ execute }) as unknown as Db;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('alert delivery', () => {
  it('includes the observed and threshold GB when storage becomes near quota', () => {
    const notices = noticesFor(new Map([['storage_near_quota', 'ok']]), [{
      id: 'storage_near_quota', state: 'firing', observed: 170, threshold: 160,
    }]);
    expect(notices).toHaveLength(1);
    expect(notices[0]?.text).toBe(
      'storage_near_quota firing: 170 GB of verified source bytes in the cloud (threshold is 80% of the allocation) (threshold 160).',
    );
  });

  it('5a: retries a failed notice on the next pass rather than losing it', async () => {
    const execute = vi.fn().mockResolvedValueOnce([alert('firing')]).mockResolvedValueOnce([alert('no_signal')]);
    const db = database(execute);
    const last = new Map<string, AlertState>();
    const pending = new Map<string, AlertNotice>();
    const post = vi.fn<(n: AlertNotice) => Promise<void>>()
      .mockRejectedValueOnce(new Error('receiver unavailable')).mockResolvedValue(undefined);

    const first = await deliverAlerts(db, { last, pending, post });
    expect(first.delivered).toEqual([]);
    expect(first.failed).toEqual([expect.objectContaining({ id: 'checksum_failures', state: 'firing' })]);
    expect([...pending.values()]).toEqual(first.failed);
    expect(last.get('checksum_failures')).toBe('firing');

    const second = await deliverAlerts(db, { last, pending, post });
    expect(second.failed).toEqual([]);
    expect(second.delivered).toEqual(first.failed);
    expect(post.mock.calls.map(([notice]) => notice.state)).toEqual(['firing', 'firing']);
    expect(pending.size).toBe(0);
    expect(last.get('checksum_failures')).toBe('no_signal');
  });

  it('5b: attempts and delivers the second notice when the first fails', async () => {
    const db = database(vi.fn().mockResolvedValue([alert('firing'), alert('firing', 'devices_offline')]));
    const pending = new Map<string, AlertNotice>();
    const send = vi.fn().mockRejectedValueOnce(new Error('unavailable')).mockResolvedValue(undefined);
    const result = await deliverAlerts(db, { last: new Map(), pending, post: send });
    expect(send).toHaveBeenCalledTimes(2);
    expect(result.failed.map((n) => n.id)).toEqual(['checksum_failures']);
    expect(result.delivered.map((n) => n.id)).toEqual(['devices_offline']);
    expect([...pending.values()]).toEqual(result.failed);
  });

  it.each<[AlertState | undefined, AlertState, AlertNotice['state'] | undefined]>([
    ['ok', 'firing', 'firing'],
    [undefined, 'firing', 'firing'],
    ['no_signal', 'firing', 'firing'],
    ['firing', 'ok', 'cleared'],
    ['firing', 'no_signal', undefined],
    ['ok', 'no_signal', undefined],
    [undefined, 'no_signal', undefined],
    ['no_signal', 'no_signal', undefined],
    ['no_signal', 'ok', undefined],
    ['ok', 'ok', undefined],
    ['firing', 'firing', undefined],
    [undefined, 'ok', undefined],
  ])('5c: %s to %s produces %s', (from, to, expected) => {
    const last = new Map<string, AlertState>(from === undefined ? [] : [['checksum_failures', from]]);
    const before = new Map(last);
    const next = [alert(to)];
    const snapshot = structuredClone(next);
    const notices = noticesFor(last, next);
    expect(notices.map((n) => n.state)).toEqual(expected === undefined ? [] : [expected]);
    expect(last).toEqual(before);
    expect(next).toEqual(snapshot);
  });

  it('5d: boot notifies only firing conditions and a healthy boot is silent', () => {
    expect(noticesFor(new Map(), [alert('ok'), alert('firing', 'devices_offline')]))
      .toEqual([expect.objectContaining({ id: 'devices_offline', state: 'firing' })]);
    expect(noticesFor(new Map(), [alert('ok'), alert('ok', 'devices_offline')])).toEqual([]);
  });

  it('5e: three failed passes keep only one pending firing notice', async () => {
    const db = database(vi.fn().mockResolvedValue([alert('firing')]));
    const pending = new Map<string, AlertNotice>();
    const last = new Map<string, AlertState>();
    const send = vi.fn().mockRejectedValue(new Error('unavailable'));
    for (let pass = 0; pass < 3; pass++) {
      await deliverAlerts(db, { last, pending, post: send });
      expect(pending.size).toBe(1);
    }
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('5g: fire, clear, re-fire during an outage recovers with only firing sent', async () => {
    const execute = vi.fn().mockResolvedValueOnce([alert('firing')])
      .mockResolvedValueOnce([alert('ok')]).mockResolvedValue([alert('firing')]);
    const pending = new Map<string, AlertNotice>();
    const last = new Map<string, AlertState>();
    const send = vi.fn<(n: AlertNotice) => Promise<void>>().mockRejectedValue(new Error('unavailable'));
    const db = database(execute);
    for (const expected of ['firing', 'cleared', 'firing']) {
      const result = await deliverAlerts(db, { last, pending, post: send });
      expect(result.delivered).toEqual([]);
      expect(result.failed.map((n) => n.state)).toEqual([expected]);
      // Never more than one queued notice per condition: the newest replaces the
      // older, so a stale 'cleared' cannot survive to be flushed after recovery.
      expect(pending.size).toBe(1);
    }
    send.mockResolvedValue(undefined);
    const result = await deliverAlerts(db, { last, pending, post: send });
    expect(result.delivered.map((n) => n.state)).toEqual(['firing']);
    expect(result.failed).toEqual([]);
    // The property this lane exists for: the last thing the receiver was sent
    // agrees with the condition's current state.
    const sent = send.mock.calls.map(([notice]) => notice.state);
    expect(sent).toEqual(['firing', 'cleared', 'firing', 'firing']);
    expect(sent.at(-1)).toBe('firing');
    expect(last.get('checksum_failures')).toBe('firing');
    expect(pending.size).toBe(0);
  });

  it('5h: re-sends after a failed clear, whose outcome the sender cannot know', async () => {
    const execute = vi.fn().mockResolvedValueOnce([alert('firing')])
      .mockResolvedValueOnce([alert('ok')]).mockResolvedValue([alert('firing')]);
    const pending = new Map<string, AlertNotice>();
    const last = new Map<string, AlertState>();
    const send = vi.fn<(n: AlertNotice) => Promise<void>>().mockResolvedValue(undefined);
    const db = database(execute);
    const first = await deliverAlerts(db, { last, pending, post: send });
    expect(first.delivered.map((n) => n.state)).toEqual(['firing']);
    send.mockRejectedValueOnce(new Error('unavailable'));
    const cleared = await deliverAlerts(db, { last, pending, post: send });
    expect(cleared.delivered).toEqual([]);
    expect(cleared.failed.map((n) => n.state)).toEqual(['cleared']);
    expect(pending.get('checksum_failures')?.state).toBe('cleared');
    expect(last.get('checksum_failures')).toBe('ok');
    // The rejected send may still have reached the receiver, so the operator may
    // be looking at 'cleared' right now. Suppressing the re-fire against the
    // stale 'firing' would strand them there, which is the whole failure this
    // seam exists to avoid. A duplicate 'firing' is the cheaper wrong answer.
    const result = await deliverAlerts(db, { last, pending, post: send });
    expect(result.delivered.map((n) => n.state)).toEqual(['firing']);
    expect(result.failed).toEqual([]);
    expect(send.mock.calls.map(([notice]) => notice.state)).toEqual(['firing', 'cleared', 'firing']);
    expect(last.get('checksum_failures')).toBe('firing');
    expect(pending.size).toBe(0);
  });

  it('5i: an undelivered fire then clear ends by delivering the clear', async () => {
    // The failed 'firing' send may still have reached the receiver, so the clear
    // has to go out. Suppressing it on the guess that nobody saw the fire is how
    // a receiver is left showing 'firing' forever against a healthy system.
    const execute = vi.fn().mockResolvedValueOnce([alert('firing')]).mockResolvedValue([alert('ok')]);
    const pending = new Map<string, AlertNotice>();
    const last = new Map<string, AlertState>();
    const send = vi.fn<(n: AlertNotice) => Promise<void>>().mockRejectedValue(new Error('unavailable'));
    const db = database(execute);
    const first = await deliverAlerts(db, { last, pending, post: send });
    expect(first.failed.map((n) => n.state)).toEqual(['firing']);
    expect(pending.get('checksum_failures')?.state).toBe('firing');
    const cleared = await deliverAlerts(db, { last, pending, post: send });
    expect(cleared.failed.map((n) => n.state)).toEqual(['cleared']);
    expect(pending.get('checksum_failures')?.state).toBe('cleared');
    send.mockResolvedValue(undefined);
    const recovered = await deliverAlerts(db, { last, pending, post: send });
    expect(recovered.delivered.map((n) => n.state)).toEqual(['cleared']);
    expect(send.mock.calls.map(([notice]) => notice.state)).toEqual(['firing', 'cleared', 'cleared']);
    expect(pending.size).toBe(0);
    expect(last.get('checksum_failures')).toBe('ok');
  });

  it('5f: text names the condition, observed count and threshold', () => {
    expect(noticesFor(new Map(), [alert('firing')])[0]?.text)
      .toBe('checksum_failures firing: 2 episodes failed read-back (threshold 1).');
  });
});

describe('storageQuotaFromEnv', () => {
  it('returns undefined when unset', () => {
    expect(storageQuotaFromEnv({})).toBeUndefined();
  });

  it('returns undefined when empty', () => {
    expect(storageQuotaFromEnv({ PLAYERONE_STORAGE_QUOTA_BYTES: '' })).toBeUndefined();
  });

  it.each<[string, number]>([
    ['200000000000', 200_000_000_000],
    ['1250000000', 1_250_000_000],
  ])('accepts %s bytes', (value, expected) => {
    expect(storageQuotaFromEnv({ PLAYERONE_STORAGE_QUOTA_BYTES: value })).toBe(expected);
  });

  it.each(['0', '-1', 'abc', '1.5', '1249999999', '200000000000000000000', ' 200000000000', '2e11'])
    ('refuses %s naming the variable, value and floor', (value) => {
      expect(() => storageQuotaFromEnv({ PLAYERONE_STORAGE_QUOTA_BYTES: value })).toThrow(
        `PLAYERONE_STORAGE_QUOTA_BYTES=${JSON.stringify(value)} must be digits only and a safe integer of at least 1,250,000,000 bytes`,
      );
    });
});

describe('webhook delivery', () => {
  it('counts log-only delivery as delivered', async () => {
    vi.stubEnv('PLAYERONE_ALERT_WEBHOOK', '');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const log = vi.fn();
    const pending = new Map<string, AlertNotice>();
    const result = await deliverAlerts(database(vi.fn().mockResolvedValue([alert('firing')])), {
      last: new Map(), pending, log,
    });
    expect(log).toHaveBeenCalledWith(result.delivered[0]?.text);
    expect(result.delivered).toHaveLength(1);
    expect(result.failed).toEqual([]);
    expect(pending.size).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('posts our JSON schema with a ten-second timeout', async () => {
    vi.stubEnv('PLAYERONE_ALERT_WEBHOOK', 'https://alerts.example.test/receive');
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    const notice = noticesFor(new Map(), [alert('firing')])[0]!;
    await post(notice);
    expect(timeout).toHaveBeenCalledWith(10_000);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://alerts.example.test/receive');
    expect(init).toMatchObject({ method: 'POST', headers: { 'content-type': 'application/json' } });
    expect(init.signal).toBe(timeout.mock.results[0]!.value);
    const body = JSON.parse(init.body);
    expect(body).toEqual({ ...notice, at: expect.any(String) });
    expect(new Date(body.at).toISOString()).toBe(body.at);
  });

  it.each(['HTTP failure', 'timeout'])('keeps %s pending without retrying in the pass', async (failure) => {
    vi.stubEnv('PLAYERONE_ALERT_WEBHOOK', 'https://alerts.example.test/receive');
    const fetch = vi.fn();
    if (failure === 'HTTP failure') fetch.mockResolvedValue(new Response(null, { status: 503 }));
    else fetch.mockRejectedValue(new DOMException('timed out', 'TimeoutError'));
    vi.stubGlobal('fetch', fetch);
    const pending = new Map<string, AlertNotice>();
    const result = await deliverAlerts(database(vi.fn().mockResolvedValue([alert('firing')])), {
      last: new Map(), pending,
    });
    expect(result.delivered).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect([...pending.values()]).toEqual(result.failed);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('alert worker runner', () => {
  it.each([0, -1, NaN, Infinity])('refuses interval %s', (intervalMs) => {
    const execute = vi.fn();
    expect(() => runAlertWorker(database(execute), { intervalMs })).toThrow('interval must be positive');
    expect(execute).not.toHaveBeenCalled();
  });

  it('runs immediately, skips overlapping ticks, retains state and stops', async () => {
    vi.useFakeTimers();
    const execute = vi.fn().mockResolvedValue([alert('firing')]);
    let finish!: () => void;
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }))
      .mockResolvedValue(undefined);
    const worker = runAlertWorker(database(execute), { intervalMs: 100, post: send, log: vi.fn() });
    try {
      expect(execute).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(300);
      expect(execute).toHaveBeenCalledTimes(1);
      finish();
      await vi.advanceTimersByTimeAsync(100);
      expect(execute).toHaveBeenCalledTimes(2);
      expect(send).toHaveBeenCalledTimes(1);
    } finally {
      worker.stop();
    }
    await vi.advanceTimersByTimeAsync(200);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it('routes a read rejection to onError and runs the next tick', async () => {
    vi.useFakeTimers();
    const error = new Error('read failed');
    const execute = vi.fn().mockRejectedValueOnce(error).mockResolvedValue([]);
    const onError = vi.fn();
    const worker = runAlertWorker(database(execute), { intervalMs: 100, onError, log: vi.fn() });
    try {
      await vi.advanceTimersByTimeAsync(100);
      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(error);
      expect(execute).toHaveBeenCalledTimes(2);
    } finally {
      worker.stop();
    }
  });
});
