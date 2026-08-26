import { createHash } from 'node:crypto';

/**
 * The payout CSV finance receives. EXPORT ONLY — there is no import route, and
 * there never will be: a CSV that can be re-imported is a CSV an operator can
 * edit in Excel, and every amount on it was frozen on `bill_lines` at
 * generation (0005, 0011). Nothing here computes money; the cells arrive as
 * the strings Postgres stored and are written out verbatim.
 *
 * Two hashes make the file evidence:
 *
 *   row_hash   SHA-256 of the row's canonical form — the RFC 4180 line of its
 *              cells, every field quoted, in column order — so one edited cell
 *              in one row is one row that no longer matches.
 *   file_hash  SHA-256 of every byte above the trailer line, BOM and comments
 *              included, so the file finance sends back is provably the file
 *              that went out. Both are stored beside the bill in
 *              `payout_exports` / `payout_export_rows`.
 *
 * Determinism is the property: the same period exported twice is
 * byte-identical, because nothing in the file is a clock, a random id or a
 * value that could be recomputed differently. The tests re-export and compare.
 *
 * `tax_withheld_vnd` is 0 on every row, and the header comment says so: the
 * PIT withholding rate and threshold for non-contract individuals is a
 * finance/legal escalation (brief §0.7 item 4), not a number engineering
 * chooses. `net_vnd` is therefore `gross_vnd` as stored — not "gross minus
 * zero", which would be arithmetic on a money path; when PIT is decided, the
 * withheld and net figures must be snapshotted on the bill, not derived here.
 */

export const EXPORT_COLUMNS = [
  'bill_id',
  'period_start',
  'period_end',
  'collector_id',
  'collector_name',
  'verified_name',
  'phone_masked',
  'method',
  'valid_minutes',
  'rate_vnd',
  'gross_vnd',
  'tax_withheld_vnd',
  'net_vnd',
  'episode_count',
  'risk_band',
  'risk_flags',
] as const;

export type ExportColumn = (typeof EXPORT_COLUMNS)[number];
export type ExportRow = Record<ExportColumn, string>;

export const PIT_COMMENT =
  '# tax_withheld_vnd is 0 on every row: the PIT withholding rate and threshold for ' +
  'non-contract individuals are undecided (payout brief, escalation 0.7 item 4). ' +
  'net_vnd is gross_vnd as stored until they are.';
export const SNAPSHOT_COMMENT =
  '# amounts are copied from bill_lines as stored at generation and are never recomputed at export time';

/** RFC 4180, quoting everything — the same rule `settle.ts` uses, for the same reason. */
export const csvRow = (cells: readonly string[]): string =>
  cells.map((c) => `"${c.replaceAll('"', '""')}"`).join(',');

export const sha256Hex = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** The canonical form a row is hashed over: its cells, in column order, as one CSV line. */
export const canonicalRow = (row: ExportRow): string => csvRow(EXPORT_COLUMNS.map((c) => row[c]));

export const rowHash = (row: ExportRow): string => sha256Hex(canonicalRow(row));

export type BuiltExport = {
  /** The whole file, BOM first, CRLF line endings, trailer last. */
  body: string;
  fileHash: string;
  /** bill_id → row_hash, in file order. */
  rowHashes: { billId: string; rowHash: string }[];
};

export function buildExport(rows: readonly ExportRow[]): BuiltExport {
  const lines: string[] = [
    '﻿' + PIT_COMMENT,
    SNAPSHOT_COMMENT,
    csvRow([...EXPORT_COLUMNS, 'row_hash']),
  ];
  const rowHashes: { billId: string; rowHash: string }[] = [];
  for (const row of rows) {
    const h = rowHash(row);
    rowHashes.push({ billId: row.bill_id, rowHash: h });
    lines.push(`${canonicalRow(row)},"${h}"`);
  }
  const above = `${lines.join('\r\n')}\r\n`;
  const fileHash = sha256Hex(above);
  return { body: `${above}# file_hash,${fileHash}\r\n`, fileHash, rowHashes };
}

/**
 * Checks a file somebody returned. Pure, and the inverse of `buildExport`:
 * the trailer names a hash, and the bytes above it either produce that hash
 * or they do not.
 */
export function verifyExport(body: string): { ok: boolean; claimed: string | null; actual: string } {
  const m = /# file_hash,([0-9a-f]{64})\r\n$/.exec(body);
  const above = m === null ? body : body.slice(0, body.length - m[0].length);
  const actual = sha256Hex(above);
  return { ok: m !== null && m[1] === actual, claimed: m?.[1] ?? null, actual };
}
