import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApiError } from '../lib/api.ts';
import { asStored, count, elapsed, vnd } from './format.ts';
import { defaultPeriod, isPeriod, periodSearch, riskSearch } from './period.ts';
import { refusalKey } from './refusals.ts';

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
