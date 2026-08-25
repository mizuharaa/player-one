/**
 * Where is the `moov` atom?
 *
 * The review screen's seeking rests entirely on this. `moov` before `mdat` puts
 * the index at the front, so a player can read it before it has the media —
 * a NECESSARY condition for cheap seeking, not a measurement of it. What a seek
 * actually costs on these files is UNVERIFIED: nobody has issued a byte-range
 * request against the served clips, and a fragmented MP4 without a useful `sidx`
 * can make a player walk fragments regardless. An MP4 with `moov` at the end has
 * its index behind the media, so a browser must fetch the tail before it can seek
 * anywhere — and with some servers or some players, effectively the whole file.
 * That direction is the one this gate is confident about.
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

async function boxes(path: string): Promise<{ size: number; boxes: Box[]; tiled: boolean }> {
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
    // Top-level boxes must tile the file exactly. A truncated capture walks off
    // the end and starts reading media as box headers: 072538 and 073055 both
    // end in types like `e¸` and `1`. Without this the walk reports a happy
    // `moov` at the front of a file that is not a whole MP4.
    return { size, boxes: found, tiled: offset === size };
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

let failures = 0;
for (const path of paths) {
  try {
    const { size, boxes: found, tiled } = await boxes(path);
    const moov = found.findIndex((b) => b.type === 'moov');
    const mdat = found.findIndex((b) => b.type === 'mdat');
    // Every branch except FRONT is a failure. Printing a warning and exiting 0
    // let this certify an unreadable or half-written file as fit to serve.
    const verdict =
      moov < 0
        ? 'NO MOOV — not a readable MP4, or truncated'
        : mdat < 0
          ? 'NO MDAT — moov present, no media'
          : moov > mdat
            ? 'BACK — seeking needs the tail first; remux at ingest'
            : tiled
              ? 'FRONT — index ahead of the media; seek cost unverified'
              : 'DAMAGED — moov is at the front, but the boxes do not tile the file';
    if (!verdict.startsWith('FRONT')) failures += 1;
    console.log(
      `${basename(path).padEnd(58)} ${String(size).padStart(12)} B  ` +
        `${found.map((b) => b.type).join(' ')}  ->  ${verdict}`,
    );
  } catch (err) {
    failures += 1;
    console.log(`${basename(path).padEnd(58)} unreadable: ${(err as Error).message}`);
  }
}

// Non-zero so this can gate a check rather than only be read by a person.
exit(failures > 0 ? 1 : 0);
