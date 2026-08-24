/**
 * Where is the `moov` atom?
 *
 * The review screen's seeking rests entirely on this. An MP4 with `moov` before
 * `mdat` can be seeked after one small range request: the index is at the front,
 * so the browser reads it and then asks for exactly the bytes it needs. An MP4
 * with `moov` at the end has its index behind the media, so a browser must
 * fetch the tail before it can seek anywhere — and with some servers or some
 * players, effectively the whole file.
 *
 * That is not something the console can fix. If PaXini's encoder writes the
 * index last, the fix is a remux at ingest — `ffmpeg -c copy -movflags
 * +faststart` — and it belongs in the import path, not in the UI.
 *
 *     node packages/api/scripts/moov.ts docs/sample_data/**\/*.mp4
 *
 * The committed fixtures under `fixtures/sessions` are 32-byte stubs and cannot
 * answer this. Run it against the real corpus.
 */

import { open, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { argv, exit } from 'node:process';

/** The first `HEAD_BYTES` is plenty: box headers are 8 or 16 bytes each. */
const HEAD_BYTES = 64 * 1024;

type Box = { type: string; offset: number; size: number };

async function boxes(path: string): Promise<{ size: number; boxes: Box[] }> {
  const { size } = await stat(path);
  const handle = await open(path, 'r');
  try {
    const head = Buffer.alloc(Math.min(HEAD_BYTES, size));
    await handle.read(head, 0, head.length, 0);

    const found: Box[] = [];
    let offset = 0;
    // Top-level boxes only: walking into them would need the whole file, and
    // the question is only about the order of the two at the top.
    while (offset + 8 <= size) {
      if (offset + 8 > head.length) {
        // Past the buffered head: read just this box's header.
        const header = Buffer.alloc(16);
        await handle.read(header, 0, 16, offset);
        const box = parse(header, 0, offset, size);
        if (box === null) break;
        found.push(box);
        offset += box.size;
        continue;
      }
      const box = parse(head, offset, offset, size);
      if (box === null) break;
      found.push(box);
      offset += box.size;
    }
    return { size, boxes: found };
  } finally {
    await handle.close();
  }
}

function parse(buf: Buffer, at: number, offset: number, fileSize: number): Box | null {
  if (at + 8 > buf.length) return null;
  let size = buf.readUInt32BE(at);
  const type = buf.toString('latin1', at + 4, at + 8);
  if (size === 1) {
    if (at + 16 > buf.length) return null;
    size = Number(buf.readBigUInt64BE(at + 8));
  }
  if (size === 0) size = fileSize - offset;
  if (size < 8) return null;
  return { type, offset, size };
}

const paths = argv.slice(2);
if (paths.length === 0) {
  console.error('usage: node packages/api/scripts/moov.ts <file.mp4> [...]');
  exit(2);
}

let anyAtBack = false;
for (const path of paths) {
  try {
    const { size, boxes: found } = await boxes(path);
    const moov = found.findIndex((b) => b.type === 'moov');
    const mdat = found.findIndex((b) => b.type === 'mdat');
    const verdict =
      moov < 0
        ? 'NO MOOV — not a readable MP4, or truncated'
        : mdat < 0
          ? 'moov present, no mdat'
          : moov < mdat
            ? 'FRONT — seeking is one small range request'
            : 'BACK — seeking needs the tail first; remux at ingest';
    if (moov >= 0 && mdat >= 0 && moov > mdat) anyAtBack = true;
    console.log(
      `${basename(path).padEnd(58)} ${String(size).padStart(12)} B  ` +
        `${found.map((b) => b.type).join(' ')}  ->  ${verdict}`,
    );
  } catch (err) {
    console.log(`${basename(path).padEnd(58)} unreadable: ${(err as Error).message}`);
  }
}

// Non-zero so this can gate a check rather than only be read by a person.
exit(anyAtBack ? 1 : 0);
