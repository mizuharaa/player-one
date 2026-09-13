/**
 * sha256, incrementally, in JavaScript.
 *
 * There is no hash in React Native and there is no hash in this app's
 * dependencies: `expo-crypto` is a native module, and a native module is an
 * APK rebuild (DEVICE_DEPS.md). The platform verifies every delivery by reading
 * the objects back and re-hashing them server-side (`verifyReadBack`), so what
 * the phone computes here is a *claim* about bytes it read off the card — it is
 * never the verdict. UPL-04's verdict is the server's.
 *
 * ponytail: JS chunked sha256, fine for demo clips; native hashing when
 * sessions reach GB scale.
 *
 * Measured on this laptop (node 24, `scripts/sha256-bench.mjs` is not kept):
 * about 25 MB/s, so a 1.5 GB camera file is a minute of phone CPU. That is the
 * ceiling the comment above names, and it is the reason `update` takes chunks
 * rather than a whole file: nothing here ever holds a session in memory.
 */

/** FIPS 180-4 §4.2.2. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n));

export class Sha256 {
  private readonly h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  private readonly w = new Uint32Array(64);
  /** The tail of the last chunk, when it did not end on a block boundary. */
  private readonly tail = new Uint8Array(64);
  private held = 0;
  private total = 0;
  private done = false;

  /** Absorbs one chunk. Any size; nothing is retained but the 64-byte tail. */
  update(chunk: Uint8Array): this {
    if (this.done) throw new Error('sha256: update after digest');
    this.total += chunk.length;
    let i = 0;
    if (this.held > 0) {
      const need = Math.min(64 - this.held, chunk.length);
      this.tail.set(chunk.subarray(0, need), this.held);
      this.held += need;
      i = need;
      if (this.held < 64) return this;
      this.compress(this.tail, 0);
      this.held = 0;
    }
    for (; i + 64 <= chunk.length; i += 64) this.compress(chunk, i);
    if (i < chunk.length) {
      this.tail.set(chunk.subarray(i), 0);
      this.held = chunk.length - i;
    }
    return this;
  }

  /** The 64-character lowercase hex digest. Single use. */
  digest(): string {
    if (this.done) throw new Error('sha256: digest twice');
    this.done = true;
    const pad = new Uint8Array(this.held < 56 ? 64 : 128);
    pad.set(this.tail.subarray(0, this.held), 0);
    pad[this.held] = 0x80;
    /**
     * The length in BITS, as a 64-bit big-endian integer. Computed in two
     * halves rather than as `total * 8`: a session file past 1 PiB would lose
     * precision in a float64, and a silently wrong digest is the one failure
     * mode of this file that nothing downstream could attribute.
     */
    const view = new DataView(pad.buffer);
    view.setUint32(pad.length - 8, Math.floor(this.total / 0x20000000));
    view.setUint32(pad.length - 4, (this.total % 0x20000000) * 8);
    for (let o = 0; o < pad.length; o += 64) this.compress(pad, o);
    let hex = '';
    for (const word of this.h) hex += word.toString(16).padStart(8, '0');
    return hex;
  }

  private compress(bytes: Uint8Array, offset: number): void {
    const w = this.w;
    for (let t = 0; t < 16; t += 1) {
      const i = offset + t * 4;
      w[t] = ((bytes[i]! << 24) | (bytes[i + 1]! << 16) | (bytes[i + 2]! << 8) | bytes[i + 3]!) >>> 0;
    }
    for (let t = 16; t < 64; t += 1) {
      const s0 = rotr(w[t - 15]!, 7) ^ rotr(w[t - 15]!, 18) ^ (w[t - 15]! >>> 3);
      const s1 = rotr(w[t - 2]!, 17) ^ rotr(w[t - 2]!, 19) ^ (w[t - 2]! >>> 10);
      w[t] = (w[t - 16]! + s0 + w[t - 7]! + s1) >>> 0;
    }
    let a = this.h[0]!, b = this.h[1]!, c = this.h[2]!, d = this.h[3]!;
    let e = this.h[4]!, f = this.h[5]!, g = this.h[6]!, h = this.h[7]!;
    for (let t = 0; t < 64; t += 1) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[t]! + w[t]!) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e;
      e = (d + t1) >>> 0;
      d = c; c = b; b = a;
      a = (t1 + t2) >>> 0;
    }
    this.h[0] = (this.h[0]! + a) >>> 0;
    this.h[1] = (this.h[1]! + b) >>> 0;
    this.h[2] = (this.h[2]! + c) >>> 0;
    this.h[3] = (this.h[3]! + d) >>> 0;
    this.h[4] = (this.h[4]! + e) >>> 0;
    this.h[5] = (this.h[5]! + f) >>> 0;
    this.h[6] = (this.h[6]! + g) >>> 0;
    this.h[7] = (this.h[7]! + h) >>> 0;
  }
}
