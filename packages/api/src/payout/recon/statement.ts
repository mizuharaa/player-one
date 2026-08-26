import { sql } from 'drizzle-orm';
import type { Db } from '@playerone/store';
import { finishRun, startRun, writeLine, type Finding, type Period } from './lines.ts';

/**
 * Manual-payout reconciliation (payout brief, AGENT F, BUILD 3): a bank or
 * wallet statement export, matched against the manual attempts an operator
 * recorded with `mark-paid`. The match is amount AND date AND reference;
 * anything unmatched, in either direction, is a discrepancy for a person.
 *
 * The parser and the matcher are pure and tested without a database. The
 * statement is whatever the bank exported — column names in English or
 * Vietnamese, amounts with dots or commas for thousands, dates ISO or
 * dd/mm/yyyy — and a line that cannot be read is an error in the run's
 * summary, never a silent skip: a statement line dropped on the floor is a
 * payment nobody reconciled.
 */

export type StatementLine = {
  /** 1-based line number in the file, for the operator. */
  line: number;
  date: Date;
  /** Whole VND, sign dropped: a payout is a debit on our side and a credit on theirs. */
  amountVnd: number;
  reference: string;
  description: string | null;
};

/**
 * A line that could not be read. It carries whatever of it COULD be read, so
 * that the ingest can still raise it as a discrepancy for a person: an
 * unreadable statement line is a payment nobody reconciled, not a line to
 * drop (F-49).
 */
export type StatementParseError = { line: number; reason: string; reference: string | null; amountVnd: number | null; raw: string };

export type ParsedStatement = { lines: StatementLine[]; errors: StatementParseError[]; delimiter: string };

const HEADERS = {
  date: ['date', 'ngay', 'ngay_gd', 'ngay_giao_dich', 'transaction_date', 'txn_date', 'value_date', 'posting_date', 'thoi_gian'],
  amount: ['amount', 'so_tien', 'amount_vnd', 'debit', 'credit', 'value', 'gia_tri'],
  reference: ['reference', 'ref', 'ref_no', 'transaction_id', 'txn_id', 'trans_id', 'ma_giao_dich', 'ma_gd', 'so_tham_chieu', 'order_id'],
  description: ['description', 'memo', 'narrative', 'noi_dung', 'dien_giai', 'counterparty', 'nguoi_nhan', 'remark'],
} as const;

/** Lower-case, diacritics stripped, non-alphanumerics folded to `_` — so `Số tiền` is `so_tien`. */
export function foldHeader(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/** References compare with case, whitespace and punctuation removed: `vcb-1 234` is `VCB1234`. */
export function normaliseReference(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Whole VND from `1.200.000`, `1,200,000`, `1200000`, `1200000.00`, `-1.200.000,00`. */
export function parseAmount(s: string): number | null {
  const t = s.replace(/\s/g, '').replace(/^[+-]/, '').replace(/(VND|đ|₫)$/i, '');
  const m = /^(\d{1,3}(?:[.,]\d{3})*|\d+)(?:[.,](\d{1,2}))?$/.exec(t);
  if (m === null) return null;
  const whole = m[1]!.replace(/[.,]/g, '');
  if (m[2] !== undefined && /[1-9]/.test(m[2])) return null; // a fractional dong is not a VND amount
  const n = Number(whole);
  return Number.isSafeInteger(n) ? n : null;
}

/** Days in a month, Gregorian; `month` is 1–12. */
const daysIn = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * A calendar instant from its parts, or null when the parts are not a date.
 * `new Date('2026-02-31')` is 3 March and `new Date('2026-04-31T00:00+07:00')`
 * is 30 April UTC — JavaScript normalises an impossible date into a real one,
 * and a statement line dated that way would then match a transfer on a day it
 * never carried (bridge finding F-49). So every component is bounds-checked
 * before the instant is built, and the instant is built from the components
 * with `Date.UTC`, never by parsing a string.
 */
function instant(y: number, mo: number, d: number, hh: number, mi: number, ss: number, ms: number, offsetMinutes: number): Date | null {
  if (y < 1970 || y > 9999 || mo < 1 || mo > 12 || d < 1 || d > daysIn(y, mo)) return null;
  if (hh > 23 || mi > 59 || ss > 59) return null;
  return new Date(Date.UTC(y, mo - 1, d, hh, mi, ss, ms) - offsetMinutes * 60_000);
}

/**
 * Exactly two forms, and nothing else:
 *
 *   ISO        `2026-08-20`, `2026-08-20T09:15`, `2026-08-20T09:15:00`, with
 *              an optional `Z` or `±hh:mm` offset (no offset means UTC)
 *   dd/mm/yyyy `20/08/2026`, `20/08/2026 09:15[:00]` — as Vietnamese banks
 *              print it, taken as Vietnam time (UTC+7). Day first, always;
 *              `08/20/2026` is not a date here.
 *
 * Impossible dates (31/02, month 13, hour 24) are null, not the nearest real
 * day — see `instant`.
 */
export function parseDate(s: string): Date | null {
  const t = s.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?(Z|[+-]\d{2}:?\d{2})?$/.exec(t);
  if (m !== null) {
    let offset = 0;
    if (m[8] !== undefined && m[8] !== 'Z') {
      const o = /^([+-])(\d{2}):?(\d{2})$/.exec(m[8])!;
      if (Number(o[2]) > 23 || Number(o[3]) > 59) return null;
      offset = (o[1] === '-' ? -1 : 1) * (Number(o[2]) * 60 + Number(o[3]));
    }
    const milliseconds = Number((m[7] ?? '').padEnd(3, '0') || 0);
    return instant(Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), milliseconds, offset);
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(t);
  if (m !== null) {
    return instant(Number(m[3]), Number(m[2]), Number(m[1]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0), 0, 7 * 60);
  }
  return null;
}

/** RFC 4180-ish: quoted fields, doubled quotes, one delimiter. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]!;
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((f) => f.trim());
}

function detectDelimiter(header: string): string {
  const counts: [string, number][] = [
    ['\t', (header.match(/\t/g) ?? []).length],
    [';', (header.match(/;/g) ?? []).length],
    [',', (header.match(/,/g) ?? []).length],
  ];
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0]![1] > 0 ? counts[0]![0] : ',';
}

export function parseStatement(text: string): ParsedStatement {
  const rawLines = text.replace(/^﻿/, '').split(/\r?\n/);
  const errors: StatementParseError[] = [];
  const lines: StatementLine[] = [];
  const headerIndex = rawLines.findIndex((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  if (headerIndex === -1) return { lines, errors: [{ line: 0, reason: 'empty statement', reference: null, amountVnd: null, raw: '' }], delimiter: ',' };
  const delimiter = detectDelimiter(rawLines[headerIndex]!);
  const header = splitCsvLine(rawLines[headerIndex]!, delimiter).map(foldHeader);
  const col = (names: readonly string[]): number => header.findIndex((h) => names.includes(h));
  const idx = { date: col(HEADERS.date), amount: col(HEADERS.amount), reference: col(HEADERS.reference), description: col(HEADERS.description) };
  // debit and credit may both be present; whichever is non-empty on the row is the amount.
  const debit = header.indexOf('debit');
  const credit = header.indexOf('credit');
  for (const [name, i] of Object.entries(idx)) {
    if (i === -1 && name !== 'description') {
      return {
        lines,
        errors: [{ line: headerIndex + 1, reason: `no ${name} column in header (${header.join(', ')})`, reference: null, amountVnd: null, raw: rawLines[headerIndex]! }],
        delimiter,
      };
    }
  }

  for (let n = headerIndex + 1; n < rawLines.length; n += 1) {
    const raw = rawLines[n]!;
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const cells = splitCsvLine(raw, delimiter);
    const lineNo = n + 1;
    const reference = (cells[idx.reference] ?? '').trim();
    let amountText = cells[idx.amount] ?? '';
    if (amountText === '' && debit !== -1 && credit !== -1) amountText = cells[debit] || cells[credit] || '';
    const amount = parseAmount(amountText);
    const partial = { reference: reference === '' ? null : reference, amountVnd: amount, raw };
    const date = parseDate(cells[idx.date] ?? '');
    if (date === null) {
      errors.push({ line: lineNo, reason: `unreadable date '${cells[idx.date] ?? ''}'`, ...partial });
      continue;
    }
    if (amount === null) {
      errors.push({ line: lineNo, reason: `unreadable amount '${amountText}'`, ...partial });
      continue;
    }
    if (reference === '') {
      errors.push({ line: lineNo, reason: 'empty reference', ...partial });
      continue;
    }
    lines.push({
      line: lineNo,
      date,
      amountVnd: amount,
      reference,
      description: idx.description === -1 ? null : (cells[idx.description] ?? null),
    });
  }
  return { lines, errors, delimiter };
}

/** A manual attempt as the matcher sees it. */
export type ManualAttempt = {
  id: string;
  billId: string;
  partnerOrderId: string;
  amountVnd: number;
  manualReference: string;
  settledAt: Date;
};

export type StatementMatch = {
  matched: { line: StatementLine; attempt: ManualAttempt; dateDeltaMs: number }[];
  findings: Finding[];
};

export const DEFAULT_DATE_TOLERANCE_MS = 2 * 24 * 60 * 60_000;

/**
 * Amount AND date AND reference. Pure.
 *
 * A reference that matches with a different amount is `AMOUNT_MISMATCH` — the
 * operator typed the right reference and the bank moved a different sum, or
 * the other way round; either way the attempt is spent by that line. A
 * reference that matches only outside the date tolerance is NOT a match: both
 * sides stay unmatched, and the detail names the near-miss so the operator
 * sees what almost lined up. Every attempt without a line is
 * `WE_SAY_PAID_THEY_DONT`; every line without an attempt is
 * `THEY_SAY_PAID_WE_DONT`.
 */
export function matchStatement(
  lines: StatementLine[],
  attempts: ManualAttempt[],
  options: { dateToleranceMs?: number } = {},
): StatementMatch {
  const tolerance = options.dateToleranceMs ?? DEFAULT_DATE_TOLERANCE_MS;
  const byRef = new Map<string, ManualAttempt[]>();
  for (const a of attempts) {
    const key = normaliseReference(a.manualReference);
    byRef.set(key, [...(byRef.get(key) ?? []), a]);
  }
  const spent = new Set<string>();
  const out: StatementMatch = { matched: [], findings: [] };

  for (const line of lines) {
    const key = normaliseReference(line.reference);
    const candidates = (byRef.get(key) ?? []).filter((a) => !spent.has(a.id));
    const within = candidates
      .filter((a) => Math.abs(a.settledAt.getTime() - line.date.getTime()) <= tolerance)
      .sort((a, b) => {
        const delta = Math.abs(a.settledAt.getTime() - line.date.getTime()) - Math.abs(b.settledAt.getTime() - line.date.getTime());
        return delta === 0 ? a.id.localeCompare(b.id) : delta;
      });
    const exact = within.find((a) => a.amountVnd === line.amountVnd);
    if (exact !== undefined) {
      spent.add(exact.id);
      out.matched.push({ line, attempt: exact, dateDeltaMs: line.date.getTime() - exact.settledAt.getTime() });
      continue;
    }
    const nearest = within[0];
    if (nearest !== undefined) {
      spent.add(nearest.id);
      out.findings.push({
        kind: 'AMOUNT_MISMATCH',
        billId: nearest.billId,
        payoutAttemptId: nearest.id,
        partnerOrderId: nearest.partnerOrderId,
        reference: line.reference,
        ourStatus: 'succeeded',
        theirStatus: 'statement',
        ourAmount: nearest.amountVnd,
        theirAmount: line.amountVnd,
        detail: { statement_line: line.line, statement_date: line.date.toISOString(), difference_vnd: line.amountVnd - nearest.amountVnd },
      });
      continue;
    }
    out.findings.push({
      kind: 'THEY_SAY_PAID_WE_DONT',
      billId: null,
      payoutAttemptId: null,
      partnerOrderId: null,
      reference: line.reference,
      ourStatus: null,
      theirStatus: 'statement',
      ourAmount: null,
      theirAmount: line.amountVnd,
      detail: {
        statement_line: line.line,
        statement_date: line.date.toISOString(),
        description: line.description,
        near_miss: candidates.length === 0 ? null : candidates.map((a) => ({ attempt_id: a.id, settled_at: a.settledAt.toISOString(), amount_vnd: a.amountVnd })),
      },
    });
  }

  for (const a of attempts) {
    if (spent.has(a.id)) continue;
    const sameRef = lines.filter((l) => normaliseReference(l.reference) === normaliseReference(a.manualReference));
    out.findings.push({
      kind: 'WE_SAY_PAID_THEY_DONT',
      billId: a.billId,
      payoutAttemptId: a.id,
      partnerOrderId: a.partnerOrderId,
      reference: a.manualReference,
      ourStatus: 'succeeded',
      theirStatus: 'not_on_statement',
      ourAmount: a.amountVnd,
      theirAmount: null,
      detail: {
        settled_at: a.settledAt.toISOString(),
        near_miss: sameRef.length === 0 ? null : sameRef.map((l) => ({ statement_line: l.line, date: l.date.toISOString(), amount_vnd: l.amountVnd })),
      },
    });
  }
  return out;
}

export type StatementIngest = {
  runId: string;
  parsed: { lines: number; errors: StatementParseError[] };
  matched: number;
  raised: number;
  still_open: number;
  findings_by_kind: Record<string, number>;
};

/**
 * Parses, matches against the manual attempts settled inside the period
 * (widened by the date tolerance on both sides, so a payment made on the
 * last evening of a period is not orphaned by the clock), and writes a run.
 * Nothing is resolved; nothing on `payout_attempts` is touched.
 */
export async function ingestStatement(
  db: Db,
  period: Period,
  csv: string,
  options: { now?: Date; dateToleranceMs?: number } = {},
): Promise<StatementIngest> {
  const now = options.now ?? new Date();
  const tolerance = options.dateToleranceMs ?? DEFAULT_DATE_TOLERANCE_MS;
  const parsed = parseStatement(csv);
  const runId = await startRun(db, 'statement', period, now);

  const rows = (await db.execute(sql`
    select id, bill_id, partner_order_id, amount_vnd, manual_reference, settled_at
      from payout_attempts
     where mode = 'manual' and status = 'succeeded'
       and settled_at >= ${new Date(period.start.getTime() - tolerance).toISOString()}::timestamptz
       and settled_at <  ${new Date(period.end.getTime() + tolerance).toISOString()}::timestamptz
     order by settled_at, attempt_seq
  `)) as unknown as { id: string; bill_id: string; partner_order_id: string; amount_vnd: string | number; manual_reference: string; settled_at: Date | string }[];
  const attempts: ManualAttempt[] = rows.map((r) => ({
    id: r.id,
    billId: r.bill_id,
    partnerOrderId: r.partner_order_id,
    amountVnd: Number(r.amount_vnd),
    manualReference: r.manual_reference,
    settledAt: new Date(r.settled_at),
  }));

  const match = matchStatement(parsed.lines, attempts, { dateToleranceMs: tolerance });
  /**
   * A line the parser could not read is still a line on the bank's
   * statement. It is raised as THEY_SAY_PAID_WE_DONT with `their_status =
   * 'unreadable'` and whatever was legible, so it reaches the same queue as
   * every other unmatched payment instead of a summary field nobody reads.
   * A header that names no columns is the whole file, not a line, and stays
   * an error on the run.
   */
  const unreadable: Finding[] = parsed.errors
    .filter((e) => e.line > (parsed.lines.length === 0 && parsed.errors.length === 1 && parsed.errors[0]!.reference === null && parsed.errors[0]!.amountVnd === null && /^(no .* column|empty statement)/.test(parsed.errors[0]!.reason) ? Number.MAX_SAFE_INTEGER : 0))
    .map((e) => ({
      kind: 'THEY_SAY_PAID_WE_DONT' as const,
      billId: null,
      payoutAttemptId: null,
      partnerOrderId: null,
      reference: e.reference ?? `statement-line-${e.line}`,
      ourStatus: null,
      theirStatus: 'unreadable',
      ourAmount: null,
      theirAmount: e.amountVnd,
      detail: { statement_line: e.line, reason: e.reason, raw: e.raw },
    }));
  const result: StatementIngest = {
    runId,
    parsed: { lines: parsed.lines.length, errors: parsed.errors },
    matched: match.matched.length,
    raised: 0,
    still_open: 0,
    findings_by_kind: {},
  };
  await db.transaction(async (tx) => {
    for (const f of [...match.findings, ...unreadable]) {
      const id = await writeLine(tx, runId, f, now);
      if (id === null) result.still_open += 1;
      else {
        result.raised += 1;
        result.findings_by_kind[f.kind] = (result.findings_by_kind[f.kind] ?? 0) + 1;
      }
    }
  });
  await finishRun(db, runId, now, {
    statement_lines: parsed.lines.length,
    parse_errors: parsed.errors,
    delimiter: parsed.delimiter,
    manual_attempts: attempts.length,
    matched: match.matched.map((m) => ({ attempt_id: m.attempt.id, statement_line: m.line.line, date_delta_hours: Math.round(m.dateDeltaMs / 3_600_000) })),
    raised: result.raised,
    still_open: result.still_open,
    findings_by_kind: result.findings_by_kind,
  });
  return result;
}
