import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MESSAGES } from '@playerone/api/i18n';
import { ApiError, payout } from '../lib/api.ts';
import { asStored, count, elapsed, vnd } from './format.ts';
import { defaultPeriod, isPeriod, periodSearch, riskSearch } from './period.ts';
import { constraintKey, isNotOnServer, refusalKey, settlementStateKey } from './refusals.ts';

/**
 * The payout console's own rules, tested without a browser or a database.
 *
 * The first block is the one the brief asks for in review: no money
 * arithmetic exists anywhere in this app. Rather than trusting the review,
 * the test reads every source file under `payout/` and `risk/` and refuses
 * an arithmetic operator next to a money-shaped identifier, a `reduce`, or a
 * `parseFloat`. Comparison is allowed — a sortable column compares two
 * server figures and never subtracts them.
 */

const SRC = join(import.meta.dirname, '..');
const DIRS = ['payout', 'risk'];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sources(p));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const MONEY = '(amount|total|vnd|gross|net|withheld|balance|shortfall|required|minutes|price|rate)';
/** `+` but not `++`; `-` but not `--` or `->`; `*`; `/` but not a comment; `%`. */
const OP = String.raw`(\+(?!\+)|-(?!-|>)|\*|/(?![/*])|%)`;
const LEFT = new RegExp(String.raw`\b[\w.]*${MONEY}[\w.]*\)?\s*${OP}=?\s*[\w(]`, 'i');
const RIGHT = new RegExp(String.raw`[\w)\]]\s*${OP}=?\s*[\w.]*${MONEY}\b`, 'i');

/** Strip string literals and comments so a class name or a sentence cannot trip the scan or hide a hit. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``');
}

describe('no money arithmetic in the console', () => {
  const files = DIRS.flatMap((d) => sources(join(SRC, d)));

  it('scans the files it claims to', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.endsWith('SettleScreen.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith('sentences.ts'))).toBe(true);
  });

  it('finds no arithmetic operator beside a money-shaped identifier', () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = code(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (LEFT.test(line) || RIGHT.test(line)) hits.push(`${file.slice(SRC.length + 1)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('finds no reduce and no parseFloat', () => {
    const hits: string[] = [];
    for (const file of files) {
      const text = code(readFileSync(file, 'utf8'));
      if (/\.reduce\(/.test(text)) hits.push(`${file}: reduce`);
      if (/parseFloat\(/.test(text)) hits.push(`${file}: parseFloat`);
    }
    expect(hits).toEqual([]);
  });

  it('the scan itself catches what it is for', () => {
    expect(LEFT.test('const x = bill.amount_vnd * 1.05;')).toBe(true);
    expect(RIGHT.test('const y = 2 + row.total;')).toBe(true);
    expect(LEFT.test('shortfall -= paid')).toBe(true);
    expect(LEFT.test("t('settle.col.minutes')")).toBe(false);
    expect(RIGHT.test('text-[var(--muted-foreground)]')).toBe(false);
    expect(LEFT.test('x < y ? -1 : x > y ? 1 : 0')).toBe(false);
  });
});

describe('formatting', () => {
  it('prints whole dong through Intl and never invents a fraction', () => {
    expect(vnd(2400, 'en')).toMatch(/2,400/);
    expect(vnd(2400, 'vi')).toMatch(/2\.400/);
    expect(vnd(null, 'en')).toBe('—');
    expect(vnd(Number.NaN, 'en')).toBe('—');
  });

  it('shows a stored decimal exactly as stored', () => {
    expect(asStored('320.0004')).toBe('320.0004');
    expect(asStored('170.0004')).toBe('170.0004');
    expect(asStored(null)).toBe('—');
  });

  it('counts', () => {
    expect(count(20, 'en')).toBe('20');
    expect(count(null, 'en')).toBe('—');
  });

  it('reports elapsed time coarsely', () => {
    const t0 = Date.parse('2026-08-26T09:00:00Z');
    expect(elapsed('2026-08-26T08:20:00Z', t0)).toBe('40m');
    expect(elapsed('2026-08-26T06:45:00Z', t0)).toBe('2h 15m');
    expect(elapsed('2026-08-23T05:00:00Z', t0)).toBe('3d 4h');
    expect(elapsed(null, t0)).toBe('—');
  });
});

describe('the period in the URL', () => {
  it('accepts a day and nothing else', () => {
    expect(isPeriod('2026-08-17')).toBe(true);
    expect(isPeriod('2026-08-17T00:00:00Z')).toBe(false);
    expect(isPeriod('2026-13-01')).toBe(false);
    expect(isPeriod(17)).toBe(false);
  });

  it('defaults to the Monday of the current UTC week', () => {
    expect(defaultPeriod(new Date('2026-08-26T15:00:00Z'))).toBe('2026-08-24'); // a Wednesday
    expect(defaultPeriod(new Date('2026-08-24T00:00:00Z'))).toBe('2026-08-24'); // the Monday itself
    expect(defaultPeriod(new Date('2026-08-23T23:59:59Z'))).toBe('2026-08-17'); // the Sunday before
  });

  it('validates the search params and keeps a bill to open', () => {
    expect(periodSearch({ period: '2026-08-17' })).toEqual({ period: '2026-08-17' });
    expect(periodSearch({ period: 'junk' }).period).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(riskSearch({ period: '2026-08-17', bill: 'b1' })).toEqual({ period: '2026-08-17', bill: 'b1' });
    expect(riskSearch({ period: '2026-08-17', bill: '' })).toEqual({ period: '2026-08-17' });
  });
});

describe('refusals become sentences', () => {
  it('maps a named constraint to its key, and the rest to what they are', () => {
    expect(refusalKey(new ApiError(409, 'refused', 'payout_attempts_amount_check'))).toBe('bo.refused.payout_attempts_amount_check');
    expect(refusalKey(new ApiError(409, 'refused', 'payout_risk_hold'))).toBe('bo.refused.payout_risk_hold');
    expect(refusalKey(new ApiError(409, 'refused', 'something_new'))).toBe('bo.refused.unknown');
    expect(refusalKey(new ApiError(403, 'finance role required'))).toBe('settle.readonly.refused');
    expect(refusalKey(new ApiError(400, 'invalid body'))).toBe('settle.invalid');
    expect(refusalKey(new ApiError(404, 'no such bill'))).toBe('settle.gone');
    expect(refusalKey(new TypeError('fetch failed'))).toBe('settle.failed');
  });
});

/* -------------------------------------------------------------------------
   What the screens must keep showing.

   The groups below are the regression proof for the fields this lane was
   built to stop dropping. A catalogue test alone would not catch a screen
   that quietly stops reading a field, and a screen scan alone would not catch
   a sentence that exists only in English — so both are here, plus the
   transport rule that keeps an aborted run's report.
   ---------------------------------------------------------------------- */

/** Every sentence this lane added, and the one it found missing. */
const NEW_KEYS = [
  'settle.generate.deferred',
  'settle.generate.skipped',
  'settle.generate.exception',
  'settle.issue.line_in_exception',
  'settle.state.pending_review',
  'settle.state.pending_settlement',
  'settle.state.bill_generated',
  'settle.state.manually_paid',
  'settle.state.exception',
  'settle.bill.lines.title',
  'settle.bill.lines.empty',
  'settle.bill.lines.exceptions',
  'settle.bill.lines.reproduce',
  'settle.bill.line.task',
  'settle.bill.line.episode',
  'settle.bill.line.unitPrice',
  'settle.bill.line.minutes',
  'settle.bill.line.amount',
  'settle.bill.line.state',
  'settle.bill.line.reviewed',
  'settle.batch.refused.title',
  'settle.batch.refused.body',
  'settle.batch.tickets.title',
  'settle.batch.tickets.body',
  'settle.batch.aborted',
  'settle.batch.aborted.at',
  'settle.batch.aborted.body',
  'settle.ticket.TICKET.POLL_EXHAUSTED',
  'settle.ticket.TICKET.ORDER_NOT_FOUND',
  'settle.ticket.TICKET.CAP_EXCEEDED',
  'settle.ticket.TICKET.BATCH_REFUSED',
  'settle.ticket.TICKET.RECON_DISCREPANCY',
];

describe('the catalogue names every new sentence', () => {
  it('holds each one in English, Chinese and Vietnamese', () => {
    /**
     * `settle.issue.line_in_exception` is why this is not bookkeeping.
     * `issuesOf` has always emitted that issue and no locale had a sentence
     * for it, so `IssueList` printed the key itself — a machine string, on
     * the bill screen, to a finance operator.
     */
    for (const locale of ['en', 'zh', 'vi'] as const) {
      const missing = NEW_KEYS.filter((key) => {
        const value = (MESSAGES[locale] as Record<string, string>)[key];
        return typeof value !== 'string' || value.trim() === '';
      });
      expect(missing, locale).toEqual([]);
    }
  });

  it('names the settlement states the schema allows, and no others', () => {
    // The CHECK in schema.ts. A state with no sentence falls back to the raw
    // string, which is why settlementStateKey returns null rather than a key
    // that would render blank.
    for (const state of ['pending_review', 'pending_settlement', 'bill_generated', 'manually_paid', 'exception']) {
      expect(settlementStateKey(state), state).toBe(`settle.state.${state}`);
    }
    expect(settlementStateKey('a_state_the_server_grew_later')).toBeNull();
  });
});

describe('the screens still read the fields the server sends', () => {
  /**
   * Each of these was measured being dropped: the API produced the field and
   * the screen never looked at it. Scanned through `code()`, so a mention in
   * a comment or inside a string cannot satisfy the check — it has to be
   * executable.
   */
  const REQUIRED: [string, string[]][] = [
    ['SettleScreen.tsx', ['deferred_to_next_period', 'skipped']],
    ['BillScreen.tsx', ['unit_price', 'effective_minutes', 'amount', 'settlement_state', 'reviewed_at']],
    ['PreflightScreen.tsx', ['report.refused', 'report.tickets', 'report.aborted']],
  ];

  for (const [file, needles] of REQUIRED) {
    it(`${file} reads them`, () => {
      const text = code(readFileSync(join(SRC, 'payout', file), 'utf8'));
      const missing = needles.filter((n) => !text.includes(n));
      expect(missing).toEqual([]);
    });
  }
});

describe('one rule for naming a refusal', () => {
  it('maps a known constraint to its sentence and an unknown one to the generic line', () => {
    expect(constraintKey('payout_batch_running')).toBe('bo.refused.payout_batch_running');
    /**
     * Deliberate change of behaviour. The batch report used to print an
     * unknown constraint verbatim — a machine string in front of finance.
     * `bo.refused.unknown` is the localised sentence that exists for exactly
     * that case.
     */
    expect(constraintKey('a_constraint_added_after_this_console')).toBe('bo.refused.unknown');
  });

  it('agrees with refusalKey, which now routes through it', () => {
    expect(refusalKey(new ApiError(409, 'refused', 'payout_batch_running'))).toBe(
      constraintKey('payout_batch_running'),
    );
  });
});

describe('an aborted batch keeps its report', () => {
  /**
   * `POST /run` answers a `BatchAborted` with 500 and the whole report in the
   * body — including transfers that already committed. Through plain
   * `call()` that body was thrown away and the operator saw a bare failure
   * after money had moved.
   */
  const report = {
    error: 'payout_batch_aborted',
    message: 'boom',
    preflight: { ok: true, payable: 2, total_vnd: 4200 },
    sent: [{ bill_id: 'bill-sent', attempt_id: 'a1', partner_order_id: 'po1', status: 'succeeded', result: 'ok' }],
    refused: [{ bill_id: 'bill-refused', collector_ref: 'C-002', constraint: 'payout_risk_hold' }],
    stopped_at: 'bill-threw',
    tickets: [
      { kind: 'TICKET.POLL_EXHAUSTED', bill_id: 'bill-sent', evidence: {}, occurred_at: '2026-08-17T00:00:00.000Z' },
    ],
  };

  const respond = (status: number, body: unknown) =>
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
    );

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the report, marked aborted, instead of throwing it away', async () => {
    vi.stubGlobal('fetch', respond(500, report));
    const run = await payout.runBatch('2026-08-17');
    expect(run?.aborted).toBe(true);
    expect(run?.sent[0]?.bill_id).toBe('bill-sent');
    expect(run?.refused[0]?.constraint).toBe('payout_risk_hold');
    expect(run?.stopped_at).toBe('bill-threw');
    expect(run?.tickets[0]?.kind).toBe('TICKET.POLL_EXHAUSTED');
  });

  it('marks a clean run as not aborted', async () => {
    const { error: _dropped, ...clean } = report;
    vi.stubGlobal('fetch', respond(200, clean));
    const run = await payout.runBatch('2026-08-17');
    expect(run?.aborted).toBe(false);
  });

  it('still throws a 409, so payout_batch_running keeps its sentence', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'refused', constraint: 'payout_batch_running' }));
    const err = await payout.runBatch('2026-08-17').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(refusalKey(err)).toBe('bo.refused.payout_batch_running');
  });

  it('still throws a 404, so the not-on-this-server path survives', async () => {
    vi.stubGlobal('fetch', respond(404, { error: 'not found' }));
    const err = await payout.runBatch('2026-08-17').catch((e: unknown) => e);
    expect(isNotOnServer(err)).toBe(true);
  });

  it('does not dress a malformed 500 up as a report', async () => {
    // `sent` alone is not a report. A half-written body must stay an error.
    vi.stubGlobal('fetch', respond(500, { error: 'payout_batch_aborted', sent: [] }));
    const err = await payout.runBatch('2026-08-17').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
  });
});
