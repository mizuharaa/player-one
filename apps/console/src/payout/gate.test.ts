import { describe, expect, it, vi } from 'vitest';
import type { PayoutBill } from '../lib/api.ts';
import { batchFingerprint, gateReasonKey, preflightGate, PREFLIGHT_WINDOW_MS, type PreflightSnapshot } from './gate.ts';

/**
 * The preflight gate at its boundaries, with a fake clock. Codex F-45: the
 * first cut unlocked payment whenever a preflight existed in the cache, and
 * a disabled observer could keep one resident indefinitely. The gate now
 * carries the snapshot's age and the batch it described, and this file is
 * what keeps it that way.
 */

const bill = (over: Partial<PayoutBill> = {}): PayoutBill => ({
  id: 'b1',
  collector_id: 'c1',
  collector_ref: 'c-0001',
  period_start: '2026-08-17T00:00:00.000Z',
  period_end: '2026-08-24T00:00:00.000Z',
  currency: 'VND',
  total: '2400.0000',
  amount_vnd: 2400,
  lines: 2,
  paid: false,
  account: { id: 'a1', method: 'WALLET', verify_status: 'verified', declared_name: 'A', verified_name: 'A', phone_masked: '09••••5678' },
  attempt: null,
  risk: { subjectType: 'bill', subjectId: 'b1', score: 0, band: 'clear', flags: [] },
  issues: [],
  ...over,
});

const snapshot = (bills: PayoutBill[], over: Partial<PreflightSnapshot> = {}): PreflightSnapshot => ({
  period_start: '2026-08-17T00:00:00.000Z',
  period_end: '2026-08-24T00:00:00.000Z',
  mode: 'manual',
  bills: bills.length,
  payable: bills.length,
  total_vnd: 0,
  required_vnd: 0,
  balance_vnd: null,
  shortfall_vnd: 0,
  ok: false,
  refusal: 'no ZaloPay client is configured, so the wallet balance cannot be read',
  counts: { no_account: 0, account_unverified: 0, total_fractional: 0, over_bank_ceiling: 0, under_bank_minimum: 0, over_cap: 0, risk_hold: 0, attempt_open: 0, already_paid: 0 },
  risk_bands: { clear: bills.length, notice: 0, review: 0, hold: 0 },
  cap_vnd: null,
  bank_ceiling_vnd: 10_000_000,
  exceptions: [],
  fingerprint: batchFingerprint(bills),
  ...over,
});

const T0 = Date.parse('2026-08-26T09:00:00Z');

describe('the preflight gate', () => {
  it('is closed with no snapshot, and says so', () => {
    const gate = preflightGate({ snapshot: undefined, fetchedAt: 0, batchFingerprint: batchFingerprint([bill()]), now: T0 });
    expect(gate).toEqual({ open: false, reason: 'missing', ageMs: null });
    expect(gateReasonKey(gate)).toBe('settle.preflight.stale');
  });

  it('opens on a fresh snapshot of the same batch', () => {
    const bills = [bill()];
    const gate = preflightGate({ snapshot: snapshot(bills), fetchedAt: T0, batchFingerprint: batchFingerprint(bills), now: T0 + 1_000 });
    expect(gate.open).toBe(true);
    expect(gateReasonKey(gate)).toBeNull();
  });

  it('closes at the window, live, with a fake clock: open one millisecond before five minutes, closed at five minutes', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(T0);
      const bills = [bill()];
      const fp = batchFingerprint(bills);
      const at = () => preflightGate({ snapshot: snapshot(bills), fetchedAt: T0, batchFingerprint: fp, now: Date.now() });
      expect(at().open).toBe(true);
      vi.setSystemTime(T0 + PREFLIGHT_WINDOW_MS - 1);
      expect(at().open).toBe(true);
      vi.setSystemTime(T0 + PREFLIGHT_WINDOW_MS);
      const late = at();
      expect(late).toEqual({ open: false, reason: 'expired', ageMs: PREFLIGHT_WINDOW_MS });
      expect(gateReasonKey(late)).toBe('settle.preflight.expired');
    } finally {
      vi.useRealTimers();
    }
    const at = (now: number) => preflightGate({ snapshot: snapshot([bill()]), fetchedAt: T0, batchFingerprint: batchFingerprint([bill()]), now });
    const late = at(T0 + PREFLIGHT_WINDOW_MS + 1);
    expect(late.open).toBe(false);
    expect(gateReasonKey(late)).toBe('settle.preflight.expired');
    // A clock that went backwards is not a fresh preflight either.
    expect(at(T0 - 1).open).toBe(false);
  });

  it('closes when the batch changed underneath it, whatever changed', () => {
    const before = [bill(), bill({ id: 'b2', collector_id: 'c2', collector_ref: 'c-0002' })];
    const snap = snapshot(before);
    const now = T0 + 5_000;
    const closedBy = (after: PayoutBill[]) => preflightGate({ snapshot: snap, fetchedAt: T0, batchFingerprint: batchFingerprint(after), now });

    // Same batch, other order: still the same batch.
    expect(closedBy([before[1]!, before[0]!]).open).toBe(true);

    for (const [what, after] of [
      ['a bill was paid', [bill({ paid: true, attempt: { id: 'at1', seq: 1, partner_order_id: 'PO-b1-1', mode: 'manual', status: 'succeeded', zlp_order_id: null, zp_trans_id: null, sub_return_code: null, manual_reference: 'VCB-1', poll_count: 0, last_polled_at: null, created_at: '2026-08-26T09:00:01Z', settled_at: '2026-08-26T09:00:01Z' } }), before[1]!]],
      ['a hold was raised', [bill({ risk: { subjectType: 'bill', subjectId: 'b1', score: 60, band: 'hold', flags: [] }, issues: ['risk_hold'] }), before[1]!]],
      ['an account was declared', [bill({ account: { id: 'a9', method: 'BANK_ACCOUNT', verify_status: 'unverified', declared_name: 'A', verified_name: null, phone_masked: '' }, issues: ['account_unverified'] }), before[1]!]],
      ['a bill appeared', [...before, bill({ id: 'b3', collector_id: 'c3', collector_ref: 'c-0003' })]],
      ['a bill vanished', [before[0]!]],
    ] as const) {
      const gate = closedBy([...after]);
      expect(gate.open, what).toBe(false);
      expect(gate.open ? null : gate.reason, what).toBe('changed');
      expect(gateReasonKey(gate), what).toBe('settle.preflight.changed');
    }
  });

  it('fingerprints ids and states, never sums', () => {
    const fp = batchFingerprint([bill({ amount_vnd: 2400 }), bill({ id: 'b2', amount_vnd: 3600 })]);
    expect(fp).toContain('b1|2400');
    expect(fp).toContain('b2|3600');
    expect(fp).not.toContain('6000');
  });
});
