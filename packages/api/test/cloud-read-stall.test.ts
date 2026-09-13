import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { S3ObjectStore, sha256OfObject } from '../src/upload-worker.ts';

/**
 * A cloud read that stops delivering bytes must fail, and it must fail without
 * holding the request that asked for it.
 *
 * Measured fault this exists for: from outside Vietnam, GreenNode HCM04 serves
 * 2–5 KB/s and the e2e loop stopped at its read-back with no error at all. The
 * S3 client had no timeout of any kind, and the one the SDK offers does not
 * cover this: Smithy's node handler clears its request timers the moment
 * response HEADERS resolve, so `requestTimeout` says nothing about a body that
 * answered 200 and then went quiet. `sha256OfObject`'s no-progress budget did
 * not cover it either — that counter only advances on an exception, and a
 * silent socket never throws one.
 *
 * So these run against the REAL adapter. A fake `ObjectStore` returning a
 * stalling async iterable would exercise none of it: no `S3Client`, no
 * `NodeHttpHandler`, no abort signal, no socket. The server below is
 * `node:http` and answers exactly the S3 shapes `S3ObjectStore.read` sends —
 * a plain GET, and a ranged GET on resume.
 *
 * The budgets are milliseconds here and hours in production
 * (`BODY_IDLE_MS` 30 s, `OBJECT_DEADLINE_MS` 2 h). Both are parameters of the
 * read for exactly this reason: the mechanism is what is under test, not the
 * constants.
 */

const OBJECT = randomBytes(64);
const DIGEST = createHash('sha256').update(OBJECT).digest('hex');

type Ask = { range: string | undefined; res: ServerResponse };

/** Every request the adapter made, and whether its response is still open. */
type Cloud = { asks: Ask[]; closed: number; endpoint: string };

let running: Server | null = null;

afterEach(async () => {
  const server = running;
  running = null;
  if (server !== null) {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((r) => server.close(() => r()));
  }
  sockets.length = 0;
});

const sockets: { destroy: () => void }[] = [];

/**
 * A store pointed at a local server that answers however the test says.
 *
 * `forcePathStyle` in the adapter makes the key `/{bucket}/{key}`, and the
 * credentials are signed against nothing — this server never checks them,
 * because what is under test is the client's behaviour on a body, not auth.
 */
async function cloud(
  handler: (req: IncomingMessage, res: ServerResponse, state: Cloud) => void,
): Promise<{ store: S3ObjectStore; state: Cloud }> {
  const state: Cloud = { asks: [], closed: 0, endpoint: '' };
  const server = createServer((req, res) => {
    state.asks.push({ range: req.headers.range, res });
    res.on('close', () => {
      state.closed += 1;
    });
    handler(req, res, state);
  });
  server.on('connection', (socket) => sockets.push(socket));
  running = server;
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  state.endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    store: new S3ObjectStore({
      endpoint: state.endpoint,
      bucket: 'readback',
      key: 'k',
      secret: 's',
    }),
    state,
  };
}

/** The offset an S3 `Range: bytes=N-` asks from, or 0 for a plain GET. */
const from = (range: string | undefined): number =>
  range === undefined ? 0 : Number(/^bytes=(\d+)-/.exec(range)?.[1] ?? 0);

/**
 * How many of the server's responses have been closed, once the event loop has
 * been given the chance to deliver the last one. `destroy` on the client side
 * and `close` on the server side are two ends of one socket, so the count is
 * eventually right and is not right the instant the read rejects.
 */
const allClosed = async (state: Cloud): Promise<number> => {
  for (let i = 0; i < 300 && state.closed < state.asks.length; i += 1) {
    await new Promise((r) => setTimeout(r, 10));
  }
  return state.closed;
};

const failure = async (p: Promise<unknown>): Promise<Error> => {
  try {
    await p;
  } catch (err) {
    return err as Error;
  }
  throw new Error('the read was expected to fail and did not');
};

describe('a cloud read that stops delivering bytes', () => {
  it('fails when the body answers with headers and then silence', async () => {
    const { store, state } = await cloud((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      res.flushHeaders();
      // …and nothing else, ever. This is the shape `requestTimeout` misses.
    });

    const started = Date.now();
    const err = await failure(sha256OfObject(store, 'obj', { idleMs: 150, deadlineMs: 60_000 }));
    const elapsed = Date.now() - started;

    // The idle watchdog, not the object deadline: it is 60 s here and the read
    // gave up in a fraction of it.
    expect(err.message).toMatch(/no chunk for 150 ms/);
    expect(elapsed).toBeLessThan(30_000);
    /**
     * Three attempts, not one. A body that never speaks is a stall, and a
     * stall is resumable — `READBACK_STALLS` is what decides it is not coming
     * back, and every one of those attempts was abandoned rather than left
     * holding a socket.
     */
    expect(state.asks.length).toBe(3);
    expect(await allClosed(state)).toBe(3);
  });

  it('fails on the object deadline when the body trickles forever', async () => {
    const { store, state } = await cloud((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/octet-stream' });
      const tick = setInterval(() => res.write(Buffer.alloc(1, 0x7a)), 60);
      res.on('close', () => clearInterval(tick));
    });

    const started = Date.now();
    const err = await failure(sha256OfObject(store, 'obj', { idleMs: 1_000, deadlineMs: 700 }));
    const elapsed = Date.now() - started;

    /**
     * One byte every 60 ms never meets a 1 s idle limit, so nothing but the
     * absolute deadline can end this. That is the case a per-call timeout
     * cannot see: every individual moment of this transfer looks healthy.
     */
    expect(err).toBeInstanceOf(Error);
    expect(elapsed).toBeGreaterThanOrEqual(700);
    expect(elapsed).toBeLessThan(20_000);
    expect(await allClosed(state)).toBe(state.asks.length);
  });

  it('resumes a dropped body from the byte the hash has eaten, and matches', async () => {
    const { store, state } = await cloud((req, res) => {
      const at = from(req.headers.range);
      if (state.asks.length === 1) {
        // The link dies mid-body: response already resolved, so the SDK's own
        // retry is out of the picture and the resume is this code's job.
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        res.write(OBJECT.subarray(0, 20));
        setTimeout(() => req.socket.destroy(), 20);
        return;
      }
      res.writeHead(at > 0 ? 206 : 200, { 'content-type': 'application/octet-stream' });
      res.end(OBJECT.subarray(at));
    });

    const digest = await sha256OfObject(store, 'obj', { idleMs: 2_000, deadlineMs: 60_000 });

    expect(digest).toBe(DIGEST);
    expect(state.asks.length).toBe(2);
    // The second GET asked for exactly what the hash had not eaten.
    expect(state.asks[1]?.range).toBe('bytes=20-');
  });

  it('stops on the object deadline however often the body makes progress', async () => {
    const { store, state } = await cloud((req, res) => {
      const at = from(req.headers.range);
      res.writeHead(at > 0 ? 206 : 200, { 'content-type': 'application/octet-stream' });
      // Four bytes, then silence. Every attempt gets a little further, which
      // resets the no-progress budget — so this object is bounded by its
      // deadline alone.
      res.write(OBJECT.subarray(at, at + 4));
    });

    const started = Date.now();
    const err = await failure(sha256OfObject(store, 'obj', { idleMs: 150, deadlineMs: 700 }));
    const elapsed = Date.now() - started;

    expect(err).toBeInstanceOf(Error);
    expect(elapsed).toBeGreaterThanOrEqual(700);
    expect(elapsed).toBeLessThan(20_000);
    /**
     * More than the three a no-progress budget allows: each attempt moved
     * bytes, so only the deadline could end the transfer. And every response
     * it opened is closed — the active stream was aborted, not orphaned.
     */
    expect(state.asks.length).toBeGreaterThan(1);
    expect(state.asks[1]?.range).toBe('bytes=4-');
    expect(await allClosed(state)).toBe(state.asks.length);
  });
});
