/**
 * A v4 UUID, in every context this console actually runs in.
 *
 * **`crypto.randomUUID` is only defined in a secure context.** That means
 * HTTPS, or `localhost` — and *not* a plain-HTTP LAN address. An upload centre
 * reaches this console over its own network, and the moment somebody opened
 * `http://172.31.57.74:5190` instead of `http://localhost:5190`, `/review` and
 * `/counter` both crashed on `crypto.randomUUID is not a function`. Seventeen
 * call sites across four screens named it directly.
 *
 * These ids are not decoration. `verdictId` on `/review` is the key behind
 * `episode_reviews_verdict_key`, which is what stops a retried request becoming
 * a second payment; the counter's two ids are the replay contract on
 * `POST /handovers` and its session. A screen that cannot mint one cannot take
 * a verdict at all.
 *
 * So this falls back in one step, not two. `crypto.getRandomValues` is **not**
 * restricted to secure contexts — only `randomUUID` and `crypto.subtle` are —
 * so a plain-HTTP page still has a real cryptographic random source, and the
 * bytes below are as good as the ones `randomUUID` would have returned. The
 * `Math.random` branch exists only for a runtime with no WebCrypto at all,
 * which no browser this console supports actually is; it is there so a missing
 * global degrades to a working screen rather than a white one.
 *
 * Version and variant bits are set the way RFC 4122 §4.4 requires, so the value
 * is a real v4 and passes the `uuid` checks the API's zod bodies apply.
 */
const HEX: string[] = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

export function uuid(): string {
  const c = (
    globalThis as {
      crypto?: { randomUUID?: () => string; getRandomValues?: (a: Uint8Array) => Uint8Array };
    }
  ).crypto;

  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === 'function') {
    c.getRandomValues(b);
  } else {
    for (let i = 0; i < 16; i += 1) b[i] = Math.floor(Math.random() * 256);
  }

  /* Version 4 in the high nibble of byte 6; variant 10xx in byte 8. */
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;

  const h = HEX;
  return (
    `${h[b[0]!]}${h[b[1]!]}${h[b[2]!]}${h[b[3]!]}-` +
    `${h[b[4]!]}${h[b[5]!]}-` +
    `${h[b[6]!]}${h[b[7]!]}-` +
    `${h[b[8]!]}${h[b[9]!]}-` +
    `${h[b[10]!]}${h[b[11]!]}${h[b[12]!]}${h[b[13]!]}${h[b[14]!]}${h[b[15]!]}`
  );
}
