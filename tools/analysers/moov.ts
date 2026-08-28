import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTool } from './frames.ts';

/**
 * A wrapper around `packages/api/scripts/moov.ts`, the container gate the
 * hardware checkout already trusts (docs/hardware-checkout.md test 19). The
 * script is a CLI with top-level code, so it is run as one and its lines are
 * read back; nothing about the walk is reimplemented here, which is the
 * point — a second box walker is a second thing that can disagree.
 *
 * One line per file, in argument order:
 *   `<basename>  <size> B  <box types>  ->  <verdict>`
 *   `<basename>  unreadable: <message>`
 * The exit code is 1 when any file is not FRONT and is not an error here.
 */

export type MoovVerdictKind = 'FRONT' | 'BACK' | 'NO MOOV' | 'NO MDAT' | 'DAMAGED' | 'unreadable';

export type MoovVerdict = {
  file: string;
  sizeBytes: number | null;
  boxes: string[];
  verdict: MoovVerdictKind;
  /** The script's full wording, for the evidence. */
  detail: string;
};

const SCRIPT = fileURLToPath(new URL('../../packages/api/scripts/moov.ts', import.meta.url));

const KINDS: MoovVerdictKind[] = ['FRONT', 'BACK', 'NO MOOV', 'NO MDAT', 'DAMAGED'];

export function parseMoovLine(line: string, file: string): MoovVerdict {
  const un = line.indexOf(' unreadable: ');
  if (un >= 0) return { file, sizeBytes: null, boxes: [], verdict: 'unreadable', detail: line.slice(un + 1).trim() };
  const arrow = line.lastIndexOf('  ->  ');
  if (arrow < 0) return { file, sizeBytes: null, boxes: [], verdict: 'unreadable', detail: line.trim() };
  const detail = line.slice(arrow + 6).trim();
  const left = line.slice(0, arrow);
  const m = /(\d+) B  (.*)$/.exec(left);
  const boxes = m ? m[2]!.trim().split(/\s+/).filter((b) => b.length > 0) : [];
  const verdict = KINDS.find((k) => detail.startsWith(k)) ?? 'unreadable';
  return { file, sizeBytes: m ? Number(m[1]) : null, boxes, verdict, detail };
}

export async function moovGate(files: readonly string[], o: { node?: string; script?: string } = {}): Promise<MoovVerdict[]> {
  if (files.length === 0) return [];
  const { stdout } = await runTool(o.node ?? process.execPath, [o.script ?? SCRIPT, ...files]);
  const lines = stdout.toString('utf8').split(/\r?\n/).filter((l) => l.trim().length > 0);
  return files
    .map((file, i): MoovVerdict => {
      const line = lines[i];
      if (line === undefined) return { file, sizeBytes: null, boxes: [], verdict: 'unreadable', detail: 'no output from moov.ts' };
      return parseMoovLine(line, file);
    })
    .map((v) => ({ ...v, file: basename(v.file) }));
}
