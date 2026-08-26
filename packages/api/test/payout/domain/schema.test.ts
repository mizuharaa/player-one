import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { closeDb, db, hasDb, truncate, useDatabase, violates } from '../../../../store/test/db.ts';
import {
  attemptRow,
  auditRow,
  countOf,
  insertAttemptAs,
  P0,
  P1,
  rows,
  seedAccount,
  seedBill,
  seedBills,
  seedFractionalBill,
  seedPayout,
  uid,
  type Ids,
} from './fixture.ts';

// One database per test file: vitest runs them in parallel and each truncates.
useDatabase('payout_schema');

/**
 * The payout invariants, tested the way they are written: in SQL, against the
 * database, with no application in the path. Everything here would hold
 * against a psql session, a worker, or a service written by somebody else,
 * which is the reason each rule is a trigger and not an `if`.
 */

describe.skipIf(!hasDb())('the payout schema', () => {
  beforeEach(truncate);
  afterAll(closeDb);

  async function seeded() {
    const d = await db();
    const ids = await seedPayout(d);
    const { bill1, bill2 } = await seedBills(d, ids);
    const account1 = await seedAccount(d, ids, 1);
    const account2 = await seedAccount(d, ids, 2);
    return { d, ids, bill1, bill2, account1, account2 };
  }

  const move = async (d: Awaited<ReturnType<typeof db>>, id: string, to: string) =>
    d.execute(sql`update payout_attempts set status = ${to} where id = ${id}`);
  const DAY_MS = 24 * 60 * 60_000;

  // -- identity ---------------------------------------------------------------

  describe('partner_order_id and attempt_seq are computed, never supplied', () => {
    it('derives PO-{bill_id}-{seq} in the database', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const id = await insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400 });
      const row = await attemptRow(d, id);
      expect(row['attempt_seq']).toBe(1);
      expect(row['partner_order_id']).toBe(`PO-${bill1}-1`);
      expect(row['status']).toBe('created');
    });

    it('refuses a supplied sequence or order id that disagrees with the computed one', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      await violates(
        'payout_attempts_identity_computed',
        insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400, attemptSeq: 7 }),
      );
      await violates(
        'payout_attempts_identity_computed',
        insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400, partnerOrderId: 'PO-random-1' }),
      );
      // The computed pair, supplied, is accepted: the application may know it, it may not choose it.
      const id = await insertAttemptAs(d, ids, ids.finA, {
        billId: bill1,
        accountId: account1,
        amountVnd: 2400,
        attemptSeq: 1,
        partnerOrderId: `PO-${bill1}-1`,
      });
      expect((await attemptRow(d, id))['partner_order_id']).toBe(`PO-${bill1}-1`);
    });

    it('numbers the next attempt after a failure, and refuses one while the last is not failed', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const first = await insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400 });
      const another = () => insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400 });
      // Walk the first attempt through every non-terminal state along legal
      // edges; at each one a second attempt is refused.
      await violates('payout_attempts_previous_not_failed', another());
      await move(d, first, 'submitted');
      await violates('payout_attempts_previous_not_failed', another());
      await move(d, first, 'unknown');
      await violates('payout_attempts_previous_not_failed', another());
      await move(d, first, 'processing');
      await violates('payout_attempts_previous_not_failed', another());
      await move(d, first, 'pending_zlp');
      await violates('payout_attempts_previous_not_failed', another());
      // pending_zlp -> failed needs an operator's reason (tested below); do it properly.
      await d.transaction(async (tx) => {
        await tx.execute(sql`update payout_attempts set status = 'failed' where id = ${first}`);
        await auditRow(tx, ids, {
          action: 'payout_attempt.resolve',
          targetTable: 'payout_attempts',
          targetId: first,
          operatorId: ids.finA,
          reason: 'ZaloPay ops confirmed the order was cancelled',
        });
      });
      const second = await insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400 });
      expect((await attemptRow(d, second))['partner_order_id']).toBe(`PO-${bill1}-2`);
      // A succeeded attempt is also not failed: no third.
      await d.execute(sql`update payout_attempts set status = 'submitted' where id = ${second}`);
      await d.execute(sql`update payout_attempts set status = 'succeeded' where id = ${second}`);
      await violates(
        'payout_attempts_previous_not_failed',
        insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400 }),
      );
    });
  });

  // -- money ------------------------------------------------------------------

  describe('the amount is the bill, in whole dong', () => {
    it('refuses an amount that is not the bill total', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      await violates(
        'payout_attempts_amount_check',
        insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2399 }),
      );
      await violates(
        'payout_attempts_amount_check',
        insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2401 }),
      );
    });

    it('refuses a bill whose total has a fractional part, because no rounding rule has been chosen', async () => {
      const { d, ids, account1 } = await seeded();
      const frac = await seedFractionalBill(d, ids);
      for (const amount of [170, 171]) {
        await violates(
          'payout_attempts_total_fractional',
          insertAttemptAs(d, ids, ids.finA, { billId: frac, accountId: account1, amountVnd: amount }),
        );
      }
      expect(await countOf(d, sql`select count(*) as n from payout_attempts`)).toBe(0);
    });

    it('refuses a bank transfer above 10,000,000 VND by name, and does not split it', async () => {
      const { d, ids } = await seeded();
      // The wallet account stops being current; the bank account is declared current.
      await d.execute(sql`update payout_accounts set is_current = false where collector_id = ${ids.collector2}`);
      const bank = await seedAccount(d, ids, 2, { method: 'BANK_ACCOUNT' });
      const big = await seedBill(d, ids, 2, P0, ['10000001.0000'], '10000001.0000');
      await violates(
        'payout_attempts_bank_ceiling',
        insertAttemptAs(d, ids, ids.finB, { billId: big, accountId: bank, amountVnd: 10_000_001 }),
      );
      expect(await countOf(d, sql`select count(*) as n from payout_attempts`)).toBe(0);
      // Exactly the limit is fine.
      const atLimit = await seedBill(d, ids, 2, { start: new Date('2026-08-03T00:00:00Z'), end: P0.start }, ['10000000.0000'], '10000000.0000');
      await insertAttemptAs(d, ids, ids.finB, { billId: atLimit, accountId: bank, amountVnd: 10_000_000 });
    });

    it('refuses a bank transfer below 2,000 VND, and lets a wallet take one dong', async () => {
      const { d, ids, account1 } = await seeded();
      await d.execute(sql`update payout_accounts set is_current = false where collector_id = ${ids.collector2}`);
      const bank = await seedAccount(d, ids, 2, { method: 'BANK_CARD' });
      const small = await seedBill(d, ids, 2, P0, ['1999.0000'], '1999.0000');
      await violates(
        'payout_attempts_bank_minimum',
        insertAttemptAs(d, ids, ids.finB, { billId: small, accountId: bank, amountVnd: 1999 }),
      );
      const one = await seedBill(d, ids, 1, P0, ['1.0000'], '1.0000');
      await insertAttemptAs(d, ids, ids.finA, { billId: one, accountId: account1, amountVnd: 1 });
    });
  });

  // -- the account ------------------------------------------------------------

  describe('the account paid is the collector\'s current one', () => {
    it("refuses another collector's account", async () => {
      const { d, ids, bill1, account2 } = await seeded();
      await violates(
        'payout_attempts_account_owner',
        insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account2, amountVnd: 2400 }),
      );
    });

    it('refuses an account that has been replaced', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      await d.execute(sql`update payout_accounts set is_current = false where id = ${account1}`);
      await violates(
        'payout_attempts_account_current',
        insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400 }),
      );
    });

    it('keeps exactly one current account per collector', async () => {
      const { d, ids } = await seeded();
      await violates('payout_accounts_current_key', seedAccount(d, ids, 1, { id: uid() }));
    });

    it('is append-only: an account may only stop being current', async () => {
      const { d, ids, account1 } = await seeded();
      await violates(
        'payout_accounts_append_only',
        d.execute(sql`update payout_accounts set declared_name = 'Somebody Else' where id = ${account1}`),
      );
      await violates(
        'payout_accounts_append_only',
        d.execute(sql`update payout_accounts set verified_name = 'NGUYEN VAN B', verify_status = 'name_mismatch' where id = ${account1}`),
      );
      // A statement that changes nothing is not a change, and passes.
      await d.execute(sql`update payout_accounts set verified_name = 'NGUYEN VAN A', verify_status = 'verified' where id = ${account1}`);
      await violates('payout_accounts_append_only', d.execute(sql`delete from payout_accounts where id = ${account1}`));
      await d.execute(sql`update payout_accounts set is_current = false where id = ${account1}`);
      await violates(
        'payout_accounts_append_only',
        d.execute(sql`update payout_accounts set is_current = true where id = ${account1}`),
      );
    });

    it('keeps the route shape: a wallet has a phone, a bank route has a code, and m_u_id is wallet-only', async () => {
      const { d, ids } = await seeded();
      await violates(
        'payout_accounts_route_check',
        d.execute(sql`
          insert into payout_accounts (id, collector_id, method, phone, bank_code, declared_name, verify_status, created_by)
            values (${uid()}, ${ids.collector1}, 'BANK_ACCOUNT', '0912345678', null, 'A', 'unverified', ${ids.opA})
        `),
      );
      await violates(
        'payout_accounts_verified_at_check',
        d.execute(sql`
          insert into payout_accounts (id, collector_id, method, phone, declared_name, verify_status, verified_at, is_current, created_by)
            values (${uid()}, ${ids.collector2}, 'WALLET', '0912345678', 'A', 'verified', null, false, ${ids.opA})
        `),
      );
    });
  });

  // -- the state machine, in the database --------------------------------------

  describe('an attempt moves along the machine\'s edges only', () => {
    async function api(d: Awaited<ReturnType<typeof db>>, ids: Ids, billId: string, accountId: string, amountVnd = 2400) {
      return insertAttemptAs(d, ids, ids.finA, { billId, accountId, amountVnd });
    }

    it('is born unsent for the API and settled for a manual payment, and nowhere else', async () => {
      const { d, ids, bill1, bill2, account1, account2 } = await seeded();
      await violates(
        'payout_attempts_initial_status',
        insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400, status: 'submitted' }),
      );
      await violates(
        'payout_attempts_initial_status',
        insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400, status: 'succeeded' }),
      );
      await violates(
        'payout_attempts_initial_status',
        insertAttemptAs(d, ids, ids.finB, { billId: bill2, accountId: account2, amountVnd: 1200, mode: 'manual', manualReference: 'VCB-1', status: 'created' }),
      );
      await violates(
        'payout_attempts_initial_status',
        insertAttemptAs(d, ids, ids.finB, { billId: bill2, accountId: account2, amountVnd: 1200, mode: 'manual', manualReference: 'VCB-1', settledAt: null }),
      );
      // manual_reference is a CHECK: a manual record with no reference is not a record.
      await violates(
        'payout_attempts_manual_reference_check',
        insertAttemptAs(d, ids, ids.finB, { billId: bill2, accountId: account2, amountVnd: 1200, mode: 'manual', manualReference: '  ', settledAt: new Date() }),
      );
      const manual = await insertAttemptAs(d, ids, ids.finB, { billId: bill2, accountId: account2, amountVnd: 1200, mode: 'manual', manualReference: 'VCB-2026-0817-01', settledAt: new Date() });
      expect((await attemptRow(d, manual))['status']).toBe('succeeded');
    });

    it('holds every legal edge and refuses every other one', async () => {
      const { d, ids, account1 } = await seeded();
      const LEGAL = new Set([
        'created->submitted',
        'created->failed',
        'submitted->succeeded',
        'submitted->processing',
        'submitted->pending_zlp',
        'submitted->failed',
        'submitted->unknown',
        'processing->succeeded',
        'processing->failed',
        'processing->pending_zlp',
        'unknown->succeeded',
        'unknown->failed',
        'unknown->pending_zlp',
        'unknown->processing',
        'pending_zlp->succeeded',
        'pending_zlp->failed',
      ]);
      const STATES = ['created', 'submitted', 'processing', 'pending_zlp', 'succeeded', 'failed', 'unknown'];
      /** Reach `from` along legal edges from a fresh attempt. */
      const path: Record<string, string[]> = {
        created: [],
        submitted: ['submitted'],
        processing: ['submitted', 'processing'],
        unknown: ['submitted', 'unknown'],
        pending_zlp: ['submitted', 'pending_zlp'],
        succeeded: ['submitted', 'succeeded'],
        failed: ['submitted', 'failed'],
      };
      // Each probe gets its own bill and its own attempt, so no probe depends
      // on the one before it. Forty-two bills, one day apart.
      let day = 0;
      for (const from of STATES) {
        for (const to of STATES) {
          if (from === to) continue;
          day += 1;
          const start = new Date(Date.UTC(2027, 0, day));
          const billId = await seedBill(d, ids, 1, { start, end: new Date(start.getTime() + DAY_MS) }, ['1200.0000'], '1200.0000');
          const id = await api(d, ids, billId, account1, 1200);
          for (const step of path[from]!) await move(d, id, step);
          const edge = `${from}->${to}`;
          const attempt = async () =>
            from === 'pending_zlp'
              ? d.transaction(async (tx) => {
                  await tx.execute(sql`update payout_attempts set status = ${to} where id = ${id}`);
                  await auditRow(tx, ids, { action: 'payout_attempt.resolve', targetTable: 'payout_attempts', targetId: id, operatorId: ids.finA, reason: 'probe' });
                })
              : move(d, id, to);
          if (LEGAL.has(edge)) {
            await attempt();
            expect((await attemptRow(d, id))['status'], edge).toBe(to);
          } else if (from === 'succeeded') {
            await violates('payout_attempts_succeeded_immutable', attempt());
          } else if (from === 'failed') {
            await violates('payout_attempts_failed_terminal', attempt());
          } else {
            await violates('payout_attempts_transition_check', attempt());
          }
        }
      }
    });

    it('stamps settled_at on the way into a terminal state', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const id = await api(d, ids, bill1, account1);
      await move(d, id, 'submitted');
      expect((await attemptRow(d, id))['settled_at']).toBeNull();
      await move(d, id, 'succeeded');
      expect((await attemptRow(d, id))['settled_at']).not.toBeNull();
    });
  });

  // -- what is written once ----------------------------------------------------

  describe('an attempt is a ledger row', () => {
    it('cannot be deleted (F-30)', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const id = await insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400 });
      await violates('payout_attempts_append_only', d.execute(sql`delete from payout_attempts where id = ${id}`));
      await violates('payout_attempts_append_only', d.execute(sql`delete from payout_attempts`));
      expect(await countOf(d, sql`select count(*) as n from payout_attempts`)).toBe(1);
    });

    it('freezes its identity and amount', async () => {
      const { d, ids, bill1, bill2, account1 } = await seeded();
      const id = await insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400 });
      for (const change of [
        sql`amount_vnd = 2399`,
        sql`bill_id = ${bill2}`,
        sql`partner_order_id = 'PO-other'`,
        sql`attempt_seq = 9`,
        sql`mode = 'manual', manual_reference = 'x'`,
        sql`created_at = now() - interval '1 day'`,
      ]) {
        await violates('payout_attempts_identity_immutable', d.execute(sql`update payout_attempts set ${change} where id = ${id}`));
      }
    });

    it('writes evidence once: order ids and codes never change, and a same-state update moves only the poll (F-31)', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const id = await insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400 });
      await move(d, id, 'submitted');
      await d.execute(sql`update payout_attempts set status = 'processing', zlp_order_id = 'zlp-1', sub_return_code = 1 where id = ${id}`);

      // A poll that learned nothing: count and clock move, an unknown id may be learned.
      await d.execute(sql`update payout_attempts set poll_count = poll_count + 1, last_polled_at = now() where id = ${id}`);
      await d.execute(sql`update payout_attempts set zp_trans_id = 'zp-1', poll_count = poll_count + 1 where id = ${id}`);
      expect((await attemptRow(d, id))['poll_count']).toBe(2);

      // Nothing else does, in the same state.
      await violates('payout_attempts_evidence_immutable', d.execute(sql`update payout_attempts set zlp_order_id = 'zlp-2' where id = ${id}`));
      await violates('payout_attempts_evidence_immutable', d.execute(sql`update payout_attempts set zp_trans_id = 'zp-2' where id = ${id}`));
      await violates('payout_attempts_evidence_immutable', d.execute(sql`update payout_attempts set sub_return_code = -68 where id = ${id}`));
      await violates('payout_attempts_evidence_immutable', d.execute(sql`update payout_attempts set settled_at = now() where id = ${id}`));
      await violates('payout_attempts_evidence_immutable', d.execute(sql`update payout_attempts set manual_reference = 'VCB-9' where id = ${id}`));
      await violates('payout_attempts_evidence_immutable', d.execute(sql`update payout_attempts set poll_count = 0 where id = ${id}`));

      // Nor across a state change: a known value stays known.
      await violates('payout_attempts_evidence_immutable', d.execute(sql`update payout_attempts set status = 'succeeded', zlp_order_id = 'zlp-2' where id = ${id}`));
      await d.execute(sql`update payout_attempts set status = 'succeeded' where id = ${id}`);

      // A succeeded attempt changes in no way at all.
      await violates('payout_attempts_succeeded_immutable', d.execute(sql`update payout_attempts set poll_count = poll_count + 1 where id = ${id}`));
      await violates('payout_attempts_succeeded_immutable', d.execute(sql`update payout_attempts set status = 'failed' where id = ${id}`));
      await violates('payout_attempts_succeeded_immutable', d.execute(sql`update payout_attempts set zp_trans_id = 'zp-9' where id = ${id}`));
    });

    it('freezes a manual reference from the moment it is written', async () => {
      const { d, ids, bill2, account2 } = await seeded();
      const id = await insertAttemptAs(d, ids, ids.finB, { billId: bill2, accountId: account2, amountVnd: 1200, mode: 'manual', manualReference: 'VCB-1', settledAt: new Date() });
      await violates('payout_attempts_succeeded_immutable', d.execute(sql`update payout_attempts set manual_reference = 'VCB-2' where id = ${id}`));
    });
  });

  // -- pending_zlp ---------------------------------------------------------------

  describe('pending_zlp is moved by an operator with a reason and by nothing else', () => {
    async function pending(d: Awaited<ReturnType<typeof db>>, ids: Ids, billId: string, accountId: string) {
      const id = await insertAttemptAs(d, ids, ids.finA, { billId, accountId, amountVnd: 2400 });
      await move(d, id, 'submitted');
      await move(d, id, 'pending_zlp');
      return id;
    }

    it('refuses a bare update, whatever the poll count or the clock says', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const id = await pending(d, ids, bill1, account1);
      await violates('payout_attempts_pending_operator_only', move(d, id, 'succeeded'));
      await violates('payout_attempts_pending_operator_only', move(d, id, 'failed'));
      await violates(
        'payout_attempts_pending_operator_only',
        d.execute(sql`update payout_attempts set status = 'succeeded', poll_count = 9999, last_polled_at = now() - interval '30 days' where id = ${id}`),
      );
      // Touching the poll fields without leaving the state is fine; it changes nothing that matters.
      await d.execute(sql`update payout_attempts set poll_count = poll_count + 1, last_polled_at = now() where id = ${id}`);
      expect((await attemptRow(d, id))['status']).toBe('pending_zlp');
    });

    it('refuses an operator without a typed reason, and a reason on the wrong row', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const id = await pending(d, ids, bill1, account1);
      await violates(
        'payout_attempts_pending_operator_only',
        d.transaction(async (tx) => {
          await tx.execute(sql`update payout_attempts set status = 'succeeded' where id = ${id}`);
          await auditRow(tx, ids, { action: 'payout_attempt.resolve', targetTable: 'payout_attempts', targetId: id, operatorId: ids.finA, reason: '   ' });
        }),
      );
      await violates(
        'payout_attempts_pending_operator_only',
        d.transaction(async (tx) => {
          await tx.execute(sql`update payout_attempts set status = 'succeeded' where id = ${id}`);
          await auditRow(tx, ids, { action: 'payout_attempt.resolve', targetTable: 'payout_attempts', targetId: uid(), operatorId: ids.finA, reason: 'wrong row' });
        }),
      );
      expect((await attemptRow(d, id))['status']).toBe('pending_zlp');
    });

    it('accepts an operator with a reason, in the same transaction', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      const id = await pending(d, ids, bill1, account1);
      await d.transaction(async (tx) => {
        await tx.execute(sql`update payout_attempts set status = 'succeeded', zp_trans_id = 'zp-manual' where id = ${id}`);
        await auditRow(tx, ids, { action: 'payout_attempt.resolve', targetTable: 'payout_attempts', targetId: id, operatorId: ids.finA, reason: 'ZaloPay ticket 4711: settled on 2026-08-20' });
      });
      expect((await attemptRow(d, id))['status']).toBe('succeeded');
    });
  });

  // -- the finance role (0013) ----------------------------------------------------

  describe('only finance creates an attempt or marks a bill paid, and never their own', () => {
    it('refuses an attempt with no audited operator, or with an operator who is not finance', async () => {
      const { d, ids, bill1, account1 } = await seeded();
      await violates('payout_finance_required', insertAttemptAs(d, ids, null, { billId: bill1, accountId: account1, amountVnd: 2400 }));
      await violates('payout_finance_required', insertAttemptAs(d, ids, ids.opA, { billId: bill1, accountId: account1, amountVnd: 2400 }));
      expect(await countOf(d, sql`select count(*) as n from payout_attempts`)).toBe(0);
      await insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400 });
    });

    it('refuses the operator who issued the bill, and the one who created the collector', async () => {
      const { d, ids, bill1, bill2, account1, account2 } = await seeded();
      await auditRow(d, ids, { action: 'bill.generate', targetTable: 'bills', targetId: bill1, operatorId: ids.finA });
      await violates('payout_separation_of_duty', insertAttemptAs(d, ids, ids.finA, { billId: bill1, accountId: account1, amountVnd: 2400 }));
      // Somebody else in finance may.
      await insertAttemptAs(d, ids, ids.finB, { billId: bill1, accountId: account1, amountVnd: 2400 });

      await auditRow(d, ids, { action: 'collector.create', targetTable: 'collectors', targetId: ids.collector2, operatorId: ids.finB });
      await violates('payout_separation_of_duty', insertAttemptAs(d, ids, ids.finB, { billId: bill2, accountId: account2, amountVnd: 1200 }));
      await insertAttemptAs(d, ids, ids.finA, { billId: bill2, accountId: account2, amountVnd: 1200 });
    });

    it('holds settlements too: manually_paid needs a finance operator on the trail', async () => {
      const { d, ids, bill1 } = await seeded();
      const paid = (billId: string) => sql`
        update settlements set settlement_state = 'manually_paid', updated_at = now()
         where id in (select settlement_id from bill_lines where bill_id = ${billId})
      `;
      await violates('payout_finance_required', d.execute(paid(bill1)));
      await violates(
        'payout_finance_required',
        d.transaction(async (tx) => {
          await tx.execute(paid(bill1));
          await auditRow(tx, ids, { action: 'bill.pay', targetTable: 'bills', targetId: bill1, operatorId: ids.opA });
        }),
      );
      await auditRow(d, ids, { action: 'bill.generate', targetTable: 'bills', targetId: bill1, operatorId: ids.finA });
      await violates(
        'payout_separation_of_duty',
        d.transaction(async (tx) => {
          await tx.execute(paid(bill1));
          await auditRow(tx, ids, { action: 'bill.pay', targetTable: 'bills', targetId: bill1, operatorId: ids.finA });
        }),
      );
      expect(await countOf(d, sql`select count(*) as n from settlements where settlement_state = 'manually_paid'`)).toBe(0);
      await d.transaction(async (tx) => {
        await tx.execute(paid(bill1));
        await auditRow(tx, ids, { action: 'bill.pay', targetTable: 'bills', targetId: bill1, operatorId: ids.finB });
      });
      expect(await countOf(d, sql`select count(*) as n from settlements where settlement_state = 'manually_paid'`)).toBe(2);
    });

    it('grants nobody finance by migration', async () => {
      const { d } = await seeded();
      const finance = await rows<{ external_ref: string }>(d, sql`select external_ref from operators where role = 'finance' order by 1`);
      // Only the two the fixture granted deliberately.
      expect(finance.map((r) => r.external_ref)).toEqual(['fin-han', 'fin-hcm']);
    });
  });

  // -- history ---------------------------------------------------------------------

  describe('history is append-only', () => {
    it('refuses to edit or delete a payout event', async () => {
      const { d, ids } = await seeded();
      await d.execute(sql`insert into payout_events (kind, collector_id, evidence) values ('IDENT.NAME_MISMATCH', ${ids.collector1}, '{"declared_name":"A","verified_name":"B"}')`);
      await violates('payout_events is append-only', d.execute(sql`update payout_events set evidence = '{}'`));
      await violates('payout_events is append-only', d.execute(sql`delete from payout_events`));
    });

    it('seals an export in the transaction that hashes it (F-32)', async () => {
      const { d, ids, bill1, bill2 } = await seeded();
      const exportId = uid();
      // Complete, in one transaction: accepted.
      await d.transaction(async (tx) => {
        await tx.execute(sql`insert into payout_exports (id, period_start, period_end, file_hash, row_count, exported_by) values (${exportId}, ${P1.start.toISOString()}::timestamptz, ${P1.end.toISOString()}::timestamptz, repeat('0', 64), 1, ${ids.finA})`);
        await tx.execute(sql`insert into payout_export_rows (export_id, bill_id, row_hash) values (${exportId}, ${bill1}, repeat('1', 64))`);
      });
      // A row attached afterwards: refused.
      await violates(
        'payout_export_rows_sealed',
        d.execute(sql`insert into payout_export_rows (export_id, bill_id, row_hash) values (${exportId}, ${bill2}, repeat('2', 64))`),
      );
      // A count that does not match what was written: refused at commit.
      await violates(
        'payout_exports_complete',
        d.transaction(async (tx) => {
          await tx.execute(sql`insert into payout_exports (id, period_start, period_end, file_hash, row_count, exported_by) values (${uid()}, ${P1.start.toISOString()}::timestamptz, ${P1.end.toISOString()}::timestamptz, repeat('0', 64), 2, ${ids.finA})`);
        }),
      );
      await violates('payout_exports is append-only', d.execute(sql`update payout_exports set file_hash = repeat('f', 64)`));
      await violates('payout_export_rows is append-only', d.execute(sql`delete from payout_export_rows`));
      expect(await countOf(d, sql`select count(*) as n from payout_export_rows`)).toBe(1);
    });
  });
});
