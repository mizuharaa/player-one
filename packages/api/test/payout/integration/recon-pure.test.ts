import { describe, expect, it } from 'vitest';
import {
  compare,
  describe as sentence,
  diffShadow,
  foldHeader,
  matchStatement,
  normaliseReference,
  parseAmount,
  parseDate,
  parseStatement,
  type Compared,
  type Finding,
  type Intended,
  type ManualAttempt,
  type StatementLine,
} from '../../../src/payout/recon/index.ts';

/**
 * The pure half of reconciliation, with no database and no server: what one
 * attempt and one answer say about each other, how a statement is read, how
 * it is matched, and how a shadow run is diffed. These run at an upload
 * centre with nothing installed, like the engine.
 */

const NOW = new Date('2026-08-26T12:00:00Z');
const H = 60 * 60_000;

const attempt = (over: Partial<Compared> = {}): Compared => ({
  id: 'a1',
  billId: 'b1',
  partnerOrderId: 'PO-b1-1',
  status: 'succeeded',
  amountVnd: 2400,
  createdAt: new Date(NOW.getTime() - H),
  zlpOrderId: 'zlp-1',
  pendingSince: null,
  ...over,
});

const found = (status: 1 | 2 | 3 | 4, amountVnd: number | null = 2400) =>
  ({ kind: 'found' as const, status, zlpOrderId: 'zlp-1', zpTransId: status === 1 ? 'zp-1' : null, amountVnd, resultUrl: null });

const kinds = (f: Finding[]) => f.map((x) => x.kind).sort();

describe('compare(): one attempt, one answer', () => {
  it('agrees when both say paid for the same amount', () => {
    expect(compare(attempt(), found(1), NOW)).toEqual([]);
  });

  it('WE_SAY_PAID_THEY_DONT when we succeeded and they report 2, 3, 4 or nothing', () => {
    for (const theirs of [found(2), found(3), found(4), { kind: 'not_found' as const }]) {
      const f = compare(attempt(), theirs, NOW);
      expect(kinds(f)).toEqual(['WE_SAY_PAID_THEY_DONT']);
      expect(f[0]).toMatchObject({ ourStatus: 'succeeded', ourAmount: 2400, payoutAttemptId: 'a1', billId: 'b1' });
    }
    expect(compare(attempt(), { kind: 'not_found' }, NOW)[0]!.theirStatus).toBe('not_found');
    expect(compare(attempt(), found(3), NOW)[0]!.theirStatus).toBe('3');
  });

  it('THEY_SAY_PAID_WE_DONT for every non-succeeded state of ours when they report 1 — failed included', () => {
    for (const status of ['created', 'submitted', 'processing', 'unknown', 'pending_zlp', 'failed'] as const) {
      const f = compare(attempt({ status }), found(1), NOW);
      expect(kinds(f), status).toContain('THEY_SAY_PAID_WE_DONT');
      expect(f.find((x) => x.kind === 'THEY_SAY_PAID_WE_DONT')).toMatchObject({ ourStatus: status, theirStatus: '1', theirAmount: 2400 });
    }
  });

  it('AMOUNT_MISMATCH whenever both name an amount and they differ, alongside whatever else is wrong', () => {
    expect(kinds(compare(attempt(), found(1, 2401), NOW))).toEqual(['AMOUNT_MISMATCH']);
    expect(compare(attempt(), found(1, 2401), NOW)[0]!.detail).toEqual({ difference_vnd: 1 });
    expect(kinds(compare(attempt({ status: 'processing' }), found(1, 100), NOW))).toEqual(['AMOUNT_MISMATCH', 'THEY_SAY_PAID_WE_DONT']);
    // No amount from them is not a mismatch.
    expect(compare(attempt(), found(1, null), NOW)).toEqual([]);
  });

  it('STALE_PROCESSING after 24 h of submitted/processing/unknown with status 3 or no order — not before, not on 1/2/4', () => {
    const old = new Date(NOW.getTime() - 25 * H);
    for (const status of ['submitted', 'processing', 'unknown'] as const) {
      expect(kinds(compare(attempt({ status, createdAt: old }), found(3), NOW)), status).toEqual(['STALE_PROCESSING']);
      expect(kinds(compare(attempt({ status, createdAt: old }), { kind: 'not_found' }, NOW)), status).toEqual(['STALE_PROCESSING']);
      expect(compare(attempt({ status, createdAt: new Date(NOW.getTime() - 23 * H) }), found(3), NOW), status).toEqual([]);
    }
    expect(kinds(compare(attempt({ status: 'processing', createdAt: old }), found(2), NOW))).toEqual([]);
    expect(kinds(compare(attempt({ status: 'processing', createdAt: old }), found(4), NOW))).toEqual([]);
    expect(compare(attempt({ status: 'processing', createdAt: old }), found(3), NOW)[0]!.detail).toEqual({ age_hours: 25 });
  });

  it('STUCK_PENDING after 72 h in pending_zlp, measured from when it entered, falling back to creation', () => {
    const entered = new Date(NOW.getTime() - 73 * H);
    expect(kinds(compare(attempt({ status: 'pending_zlp', createdAt: new Date(NOW.getTime() - 100 * H), pendingSince: entered }), found(4), NOW))).toEqual(['STUCK_PENDING']);
    expect(compare(attempt({ status: 'pending_zlp', createdAt: new Date(NOW.getTime() - 100 * H), pendingSince: new Date(NOW.getTime() - 71 * H) }), found(4), NOW)).toEqual([]);
    expect(kinds(compare(attempt({ status: 'pending_zlp', createdAt: entered }), found(4), NOW))).toEqual(['STUCK_PENDING']);
    expect(compare(attempt({ status: 'pending_zlp', createdAt: entered }), found(4), NOW)[0]!.detail).toMatchObject({ pending_since: entered.toISOString(), pending_hours: 73 });
    // Pending at ours and paid at theirs is both stuck and a payment we have not recorded.
    expect(kinds(compare(attempt({ status: 'pending_zlp', createdAt: entered }), found(1), NOW))).toEqual(['STUCK_PENDING', 'THEY_SAY_PAID_WE_DONT']);
  });

  it('F-48: a provider order behind an attempt we never sent is never clean — 1 is THEY_SAY_PAID, 2/3/4 is ORPHAN, not found is clean', () => {
    const created = attempt({ status: 'created', zlpOrderId: null });
    expect(kinds(compare(created, found(1), NOW))).toEqual(['THEY_SAY_PAID_WE_DONT']);
    for (const s of [2, 3, 4] as const) {
      const f = compare(created, found(s), NOW);
      expect(kinds(f), `status ${s}`).toEqual(['ORPHAN_AT_ZLP']);
      expect(f[0], `status ${s}`).toMatchObject({ ourStatus: 'created', theirStatus: String(s), theirAmount: 2400, payoutAttemptId: 'a1', detail: { provider_status: s } });
    }
    expect(compare(created, { kind: 'not_found' }, NOW)).toEqual([]);
    // Old and never sent is not "stale processing": it was never processing.
    expect(compare(attempt({ status: 'created', createdAt: new Date(NOW.getTime() - 48 * H) }), { kind: 'not_found' }, NOW)).toEqual([]);
  });

  it('F-48: a provider order still in flight behind an attempt we closed as failed is ORPHAN; a 2 is agreement', () => {
    const failed = attempt({ status: 'failed' });
    expect(kinds(compare(failed, found(1), NOW))).toEqual(['THEY_SAY_PAID_WE_DONT']);
    expect(compare(failed, found(2), NOW)).toEqual([]);
    for (const s of [3, 4] as const) {
      expect(kinds(compare(failed, found(s), NOW)), `status ${s}`).toEqual(['ORPHAN_AT_ZLP']);
      expect(compare(failed, found(s), NOW)[0]!.detail['why']).toMatch(/closed this attempt as failed/);
    }
    expect(compare(failed, { kind: 'not_found' }, NOW)).toEqual([]);
  });

  it('learns nothing from a refusal, a system error or a dead socket', () => {
    for (const answer of [
      { kind: 'rejected' as const, subCode: -402, retryable: false as const },
      { kind: 'system' as const, subCode: -503, retryable: true as const },
      { kind: 'error' as const, message: 'ECONNRESET' },
    ]) {
      expect(compare(attempt(), answer, NOW)).toEqual([]);
      expect(compare(attempt({ status: 'pending_zlp', createdAt: new Date(NOW.getTime() - 100 * H) }), answer, NOW)).toEqual([]);
    }
  });

  it('every sentence carries the numbers an operator needs', () => {
    for (const f of [
      ...compare(attempt(), found(3), NOW),
      ...compare(attempt({ status: 'failed' }), found(1), NOW),
      ...compare(attempt(), found(1, 2401), NOW),
      ...compare(attempt({ status: 'processing', createdAt: new Date(NOW.getTime() - 30 * H) }), found(3), NOW),
      ...compare(attempt({ status: 'pending_zlp', createdAt: new Date(NOW.getTime() - 100 * H) }), found(4), NOW),
    ]) {
      const s = sentence(f);
      expect(s, f.kind).toMatch(/\d/);
      expect(s, f.kind).not.toMatch(/score|anomaly|threshold/i);
    }
    expect(sentence(compare(attempt(), found(1, 2401), NOW)[0]!)).toBe('Our ledger says 2400 VND; the other side says 2401 VND for the same payment.');
  });
});

// ---------------------------------------------------------------------------

describe('reading a statement', () => {
  it('folds headers the way a Vietnamese bank prints them', () => {
    expect(foldHeader('Số tiền')).toBe('so_tien');
    expect(foldHeader('Ngày giao dịch')).toBe('ngay_giao_dich');
    expect(foldHeader('Mã GD')).toBe('ma_gd');
    expect(foldHeader(' Transaction ID ')).toBe('transaction_id');
    expect(foldHeader('Nội dung')).toBe('noi_dung');
  });

  it('compares references without case, spaces or punctuation', () => {
    expect(normaliseReference('vcb-1 234')).toBe('VCB1234');
    expect(normaliseReference('VCB1234')).toBe('VCB1234');
    expect(normaliseReference('FT26238/0091.')).toBe('FT262380091');
  });

  it('reads whole dong with either thousands separator, and refuses a fractional dong', () => {
    expect(parseAmount('2400')).toBe(2400);
    expect(parseAmount('1.200.000')).toBe(1_200_000);
    expect(parseAmount('1,200,000')).toBe(1_200_000);
    expect(parseAmount('1200000.00')).toBe(1_200_000);
    expect(parseAmount('-1.200.000,00')).toBe(1_200_000);
    expect(parseAmount('2 400 VND')).toBe(2400);
    expect(parseAmount('12.5')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('')).toBeNull();
  });

  it('reads ISO and dd/mm/yyyy dates, the latter as Vietnam time', () => {
    expect(parseDate('2026-08-20')!.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(parseDate('2026-08-20T09:15:00+07:00')!.toISOString()).toBe('2026-08-20T02:15:00.000Z');
    expect(parseDate('2026-08-20T09:15:00.125Z')!.toISOString()).toBe('2026-08-20T09:15:00.125Z');
    expect(parseDate('20/08/2026')!.toISOString()).toBe('2026-08-19T17:00:00.000Z');
    expect(parseDate('20/08/2026 09:15')!.toISOString()).toBe('2026-08-20T02:15:00.000Z');
    expect(parseDate('08/20/2026')).toBeNull();
    expect(parseDate('yesterday')).toBeNull();
  });

  it('F-49: an impossible date is null, never the nearest real day, in both forms', () => {
    // JavaScript alone would make these 3 March, 1 May, 1 March, 13 January 2027 and the next hour.
    for (const bad of [
      '2026-02-31',
      '2026-04-31',
      '2026-02-29', // 2026 is not a leap year
      '2026-13-01',
      '2026-00-10',
      '2026-08-00',
      '2026-08-20T24:00',
      '2026-08-20T09:60',
      '2026-08-20T09:15:60',
      '2026-08-20T09:15:00+07:60',
      '2026-08-20T09:15:00+24:00',
      '2026-08-20T09:15:00-99:00',
      '31/02/2026',
      '31/04/2026',
      '29/02/2026',
      '01/13/2026',
      '00/08/2026',
      '32/08/2026',
      '20/08/2026 24:00',
      '20/08/2026 09:60',
    ]) {
      expect(parseDate(bad), bad).toBeNull();
    }
    // The real leap day, and the edges, still read.
    expect(parseDate('2028-02-29')!.toISOString()).toBe('2028-02-29T00:00:00.000Z');
    expect(parseDate('29/02/2028')!.toISOString()).toBe('2028-02-28T17:00:00.000Z');
    expect(parseDate('2026-12-31T23:59:59Z')!.toISOString()).toBe('2026-12-31T23:59:59.000Z');
    expect(parseDate('30/04/2026')!.toISOString()).toBe('2026-04-29T17:00:00.000Z');
  });

  it('F-49: an impossible date on a statement line is an unreadable line that keeps what was legible', () => {
    const p = parseStatement(['date,amount,reference', '2026-02-31,2400,VCB-1', '31/04/2026,1.200,VCB-2'].join('\n'));
    expect(p.lines).toEqual([]);
    expect(p.errors).toEqual([
      { line: 2, reason: "unreadable date '2026-02-31'", reference: 'VCB-1', amountVnd: 2400, raw: '2026-02-31,2400,VCB-1' },
      { line: 3, reason: "unreadable date '31/04/2026'", reference: 'VCB-2', amountVnd: 1200, raw: '31/04/2026,1.200,VCB-2' },
    ]);
  });

  it('parses a Vietnamese semicolon export and an English quoted one to the same lines', () => {
    const vi = [
      'Ngày giao dịch;Số tiền;Mã giao dịch;Nội dung',
      '20/08/2026 09:15;2.400;VCB-0001;Thanh toan c-0001',
      '21/08/2026;1.200;VCB-0002;"Thanh toan; c-0002"',
    ].join('\r\n');
    const en = [
      '﻿date,amount,reference,description',
      '2026-08-20T02:15:00Z,"2,400",VCB-0001,Thanh toan c-0001',
      '2026-08-20T17:00:00Z,1200,VCB-0002,"Thanh toan, c-0002"',
    ].join('\n');
    const a = parseStatement(vi);
    const b = parseStatement(en);
    expect(a.errors).toEqual([]);
    expect(b.errors).toEqual([]);
    expect(a.delimiter).toBe(';');
    expect(b.delimiter).toBe(',');
    const strip = (l: StatementLine) => ({ date: l.date.toISOString(), amountVnd: l.amountVnd, reference: l.reference });
    expect(a.lines.map(strip)).toEqual(b.lines.map(strip));
    expect(a.lines[1]!.description).toBe('Thanh toan; c-0002');
  });

  it('takes the amount from whichever of debit/credit is filled, and skips comments and blank lines', () => {
    const text = ['date\tdebit\tcredit\treference', '# exported 2026-08-26', '2026-08-20\t2400\t\tR1', '', '2026-08-21\t\t500\tR2'].join('\n');
    const p = parseStatement(text);
    expect(p.errors).toEqual([]);
    expect(p.lines.map((l) => [l.reference, l.amountVnd])).toEqual([
      ['R1', 2400],
      ['R2', 500],
    ]);
  });

  it('reports every unreadable line by number rather than dropping it', () => {
    const text = ['date,amount,reference', '2026-08-20,2400,R1', 'soon,2400,R2', '2026-08-20,two,R3', '2026-08-20,2400,'].join('\n');
    const p = parseStatement(text);
    expect(p.lines.map((l) => l.reference)).toEqual(['R1']);
    expect(p.errors).toEqual([
      { line: 3, reason: "unreadable date 'soon'", reference: 'R2', amountVnd: 2400, raw: 'soon,2400,R2' },
      { line: 4, reason: "unreadable amount 'two'", reference: 'R3', amountVnd: null, raw: '2026-08-20,two,R3' },
      { line: 5, reason: 'empty reference', reference: null, amountVnd: 2400, raw: '2026-08-20,2400,' },
    ]);
  });

  it('refuses a statement whose header names no amount, date or reference', () => {
    const p = parseStatement('when,how much,who\n2026-08-20,2400,R1');
    expect(p.lines).toEqual([]);
    expect(p.errors[0]!.reason).toMatch(/no date column/);
    expect(parseStatement('').errors).toMatchObject([{ line: 0, reason: 'empty statement' }]);
  });
});

// ---------------------------------------------------------------------------

describe('matching a statement against manual attempts', () => {
  const T = new Date('2026-08-20T10:00:00Z');
  const line = (over: Partial<StatementLine>): StatementLine => ({ line: 2, date: T, amountVnd: 2400, reference: 'VCB-0001', description: null, ...over });
  const manual = (over: Partial<ManualAttempt>): ManualAttempt => ({ id: 'm1', billId: 'b1', partnerOrderId: 'PO-b1-1', amountVnd: 2400, manualReference: 'VCB 0001', settledAt: T, ...over });

  it('matches on amount, date and reference, whatever the reference punctuation', () => {
    const m = matchStatement([line({})], [manual({})]);
    expect(m.matched).toHaveLength(1);
    expect(m.findings).toEqual([]);
  });

  it('a matching reference with a different amount is AMOUNT_MISMATCH, and spends the attempt', () => {
    const m = matchStatement([line({ amountVnd: 2300 })], [manual({})]);
    expect(m.matched).toEqual([]);
    expect(m.findings.map((f) => f.kind)).toEqual(['AMOUNT_MISMATCH']);
    expect(m.findings[0]).toMatchObject({ payoutAttemptId: 'm1', billId: 'b1', ourAmount: 2400, theirAmount: 2300, detail: { difference_vnd: -100, statement_line: 2 } });
  });

  it('a matching reference outside the date tolerance is not a match: both sides stay open, naming the near-miss', () => {
    const late = new Date(T.getTime() + 3 * 24 * 60 * 60_000);
    const m = matchStatement([line({ date: late })], [manual({})]);
    expect(m.matched).toEqual([]);
    expect(m.findings.map((f) => f.kind).sort()).toEqual(['THEY_SAY_PAID_WE_DONT', 'WE_SAY_PAID_THEY_DONT']);
    const theirs = m.findings.find((f) => f.kind === 'THEY_SAY_PAID_WE_DONT')!;
    expect(theirs.billId).toBeNull();
    expect((theirs.detail['near_miss'] as unknown[])).toHaveLength(1);
    const ours = m.findings.find((f) => f.kind === 'WE_SAY_PAID_THEY_DONT')!;
    expect(ours).toMatchObject({ payoutAttemptId: 'm1', ourAmount: 2400, theirStatus: 'not_on_statement' });
    expect((ours.detail['near_miss'] as unknown[])).toHaveLength(1);
    // Widen the tolerance and it matches.
    expect(matchStatement([line({ date: late })], [manual({})], { dateToleranceMs: 4 * 24 * 60 * 60_000 }).matched).toHaveLength(1);
  });

  it('unmatched in either direction is a discrepancy', () => {
    const m = matchStatement([line({ reference: 'VCB-0009', amountVnd: 500 })], [manual({})]);
    expect(m.findings.map((f) => f.kind).sort()).toEqual(['THEY_SAY_PAID_WE_DONT', 'WE_SAY_PAID_THEY_DONT']);
    expect(m.findings.find((f) => f.kind === 'THEY_SAY_PAID_WE_DONT')!.detail['near_miss']).toBeNull();
  });

  it('spends each attempt once: two lines with one reference match one attempt and leave one line over', () => {
    const m = matchStatement([line({ line: 2 }), line({ line: 3 })], [manual({})]);
    expect(m.matched).toHaveLength(1);
    expect(m.findings.map((f) => f.kind)).toEqual(['THEY_SAY_PAID_WE_DONT']);
    expect(m.findings[0]!.detail['statement_line']).toBe(3);
  });

  it('chooses the nearest attempt when a reference is reused', () => {
    const day = 24 * 60 * 60_000;
    const older = manual({ id: 'm-old', billId: 'b-old', settledAt: new Date(T.getTime() - day) });
    const nearer = manual({ id: 'm-near', billId: 'b-near', settledAt: new Date(T.getTime() - 60_000) });
    const exact = matchStatement([line({})], [older, nearer]);
    expect(exact.matched[0]!.attempt.id).toBe('m-near');

    const mismatch = matchStatement([line({ amountVnd: 2300 })], [older, nearer]);
    expect(mismatch.findings[0]).toMatchObject({ kind: 'AMOUNT_MISMATCH', payoutAttemptId: 'm-near', billId: 'b-near' });
  });

  it('describes an order behind a local attempt without claiming the attempt is absent (F-48)', () => {
    const finding = compare(attempt({ status: 'created', zlpOrderId: null }), found(3), NOW);
    expect(finding).toHaveLength(1);
    expect(sentence(finding[0]!)).toContain('records its attempt as created');
    expect(sentence(finding[0]!)).not.toContain('has no attempt');
  });
});

// ---------------------------------------------------------------------------

describe('diffing a shadow run against what was paid', () => {
  const intended = (over: Partial<Intended>): Intended => ({ bill_id: 'b1', collector_id: 'c1', collector_ref: 'c-0001', amount_vnd: 2400, would_send: true, issues: [], risk_band: 'clear', ...over });

  it('agrees when the rail would have sent it and a manual payment of the same amount succeeded', () => {
    expect(diffShadow([intended({})], [{ billId: 'b1', mode: 'manual', status: 'succeeded', amountVnd: 2400, manualReference: 'R' }])).toEqual([]);
  });

  it('SHADOW_UNPAID when the rail would have sent it and nothing succeeded', () => {
    for (const actual of [
      { billId: 'b1', mode: null, status: null, amountVnd: null, manualReference: null },
      { billId: 'b1', mode: 'api' as const, status: 'failed', amountVnd: 2400, manualReference: null },
    ]) {
      const f = diffShadow([intended({})], [actual]);
      expect(f.map((x) => x.kind)).toEqual(['SHADOW_UNPAID']);
      expect(f[0]).toMatchObject({ billId: 'b1', ourStatus: 'would_send', ourAmount: 2400 });
    }
  });

  it('SHADOW_UNINTENDED when something succeeded that the rail would have refused, naming why', () => {
    const f = diffShadow(
      [intended({ would_send: false, issues: ['account_unverified'] })],
      [{ billId: 'b1', mode: 'manual', status: 'succeeded', amountVnd: 2400, manualReference: 'R' }],
    );
    expect(f.map((x) => x.kind)).toEqual(['SHADOW_UNINTENDED']);
    expect(f[0]!.detail).toMatchObject({ issues: ['account_unverified'] });
    expect(sentence(f[0]!)).toContain('account_unverified');
  });

  it('AMOUNT_MISMATCH when both agree it was paid and not on how much; agrees when neither would pay', () => {
    expect(diffShadow([intended({})], [{ billId: 'b1', mode: 'manual', status: 'succeeded', amountVnd: 2300, manualReference: 'R' }]).map((x) => x.kind)).toEqual(['AMOUNT_MISMATCH']);
    expect(diffShadow([intended({ would_send: false, issues: ['risk_hold'] })], [{ billId: 'b1', mode: null, status: null, amountVnd: null, manualReference: null }])).toEqual([]);
  });
});
