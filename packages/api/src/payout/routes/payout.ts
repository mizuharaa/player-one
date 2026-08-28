import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { schema, type Db } from '@playerone/store';
import { mutate } from '../../audit.ts';
import { financeGuard, type Actor, type CounterActor } from '../../actor.ts';
import { attemptById, applyEvent, insertAttempt, latestAttemptOf } from '../domain/attempts.ts';
import type { VerifyReceiver } from '../domain/client-contract.ts';
import { assertPayoutBootInvariants, type PayoutOptions } from '../domain/config.ts';
import { emitEvent } from '../domain/events.ts';
import { buildExport, type ExportRow } from '../domain/export.ts';
import { maskPhone } from '../domain/names.ts';
import { IllegalTransition, TERMINAL } from '../domain/state.ts';
import { verifyDeclaration } from '../domain/verify.ts';
import { BatchAborted, loadBatch, loadBill, payBill, preflight, refusalFor, runBatch, type BatchBill, type BatchRun } from '../worker/batch.ts';

/**
 * The payout routes (Agent B brief, BUILD 4). Every mutation goes through
 * `mutate`; every mutating route requires the finance role; every refusal a
 * person can trip is a constraint name the console maps to a sentence.
 *
 * Three things are decided elsewhere and only reported here:
 *
 *   - Whether an attempt may exist: `payout_attempts_guard` and
 *     `payout_attempts_by_finance` (0012, 0013). This file inserts and reports
 *     what the database said, the way the back office does.
 *   - What ZaloPay's answer means: `domain/state.ts`.
 *   - What a bill is worth: `bills.total`, frozen. `wholeVnd` only rounds it
 *     down to the whole dong a transfer moves.
 *
 * Mode. `PLAYERONE_PAYOUT_MODE=manual` (the default, and the pilot) means an
 * operator transfers the money themselves and records the reference with
 * `mark-paid`; `/pay` answers 409 so the rail cannot be used by accident.
 * `api` means `/pay` sends a transfer through Agent A's client and the poller
 * finishes it. `mark-paid` works in both modes, because a manual payment is
 * always possible — after a failed API attempt, for instance.
 */

const uuid = z.string().uuid();
const text = z.string().trim().min(1);

const AccountBody = z
  .object({
    id: uuid,
    collector_id: uuid,
    method: z.enum(['WALLET', 'BANK_ACCOUNT', 'BANK_CARD']),
    declared_name: text,
    /** WALLET: Vietnamese mobile. Validated for shape only; ZaloPay decides. */
    phone: z.string().trim().regex(/^0\d{9}$/, 'a Vietnamese mobile number: 10 digits starting with 0').optional(),
    bank_code: text.optional(),
    /** Full number, used for the verify call and NOT stored. Only the last four survive. */
    account_no: z.string().trim().regex(/^\d{4,32}$/).optional(),
  })
  .refine((b) => (b.method === 'WALLET' ? b.phone !== undefined : b.bank_code !== undefined && b.account_no !== undefined), {
    message: 'a wallet needs a phone; a bank route needs a bank code and an account number',
  });

const MarkPaidBody = z.object({
  /** REQUIRED: the reference of the transfer the operator made. */
  manual_reference: text,
  /** Retyped, not clicked: must equal the bill's whole-dong total. */
  amount_vnd: z.number().int().positive(),
});

const ResolveBody = z.object({
  outcome: z.enum(['succeeded', 'failed']),
  reason: text,
  zp_trans_id: text.optional(),
});

type Reply = { code: (n: number) => { send: (b: unknown) => unknown } };

/** Same walk as `backoffice.ts` and `violates()`: the constraint on the cause chain. */
function constraintOf(err: unknown): string | undefined {
  for (let e: unknown = err; e !== null && e !== undefined; e = (e as { cause?: unknown }).cause) {
    const name = (e as { constraint_name?: string }).constraint_name;
    if (name !== undefined && name !== '') return name;
  }
  return undefined;
}

/**
 * The constraints a person can trip on a payout route, which become a 409
 * with a machine-readable reason. Agent D maps each to a sentence
 * (`bo.refused.<name>` in `i18n.ts`); the names are listed here so the list
 * is one edit away from the console.
 */
export const PAYOUT_REFUSALS = new Set([
  // payout_attempts_guard (0012)
  'payout_attempts_previous_not_failed',
  'payout_attempts_amount_check',
  'payout_attempts_account_owner',
  'payout_attempts_account_current',
  'payout_attempts_account_unverified',
  'payout_attempts_bank_ceiling',
  'payout_attempts_bank_minimum',
  'payout_attempts_transition_check',
  'payout_attempts_succeeded_immutable',
  'payout_attempts_failed_terminal',
  'payout_attempts_pending_operator_only',
  'payout_attempts_manual_reference_check',
  // payout_finance_in_transaction (0013)
  'payout_finance_required',
  'payout_separation_of_duty',
  // payout_accounts
  'payout_accounts_current_key',
  'payout_accounts_append_only',
  // 0005: a settlement already paid, or moved to exception in between
  'settlements_transition_check',
]);

/** Refusals this file and the batch worker raise themselves, which no constraint carries. */
export const PAYOUT_API_REFUSALS = new Set([
  'payout_mode_manual',
  'payout_no_client',
  'payout_account_missing',
  'payout_account_unverified',
  'payout_bank_details_unavailable',
  'payout_cap_exceeded',
  'payout_risk_hold',
  'payout_already_paid',
  'payout_settlement_exception',
  'payout_accounts_id_reused',
  /** A declaration the route would not store: bad shape, or a wallet with no phone. */
  'payout_account_declaration_invalid',
  /** An attempt for this collector is open, so the destination may not move under it. */
  'payout_account_locked_while_paying',
  /** The counter route only: this collector has handed nothing in at this centre. */
  'payout_account_not_this_centre',
  'payout_attempt_not_resolvable',
  'payout_bill_period_mismatch',
  'payout_batch_running',
  'payout_transfer_rejected',
  'payout_bill_not_payable',
]);

export function registerPayout(
  app: FastifyInstance,
  db: Db,
  requireActor: (req: FastifyRequest, reply: Reply) => Promise<unknown>,
  options: PayoutOptions = {},
): void {
  assertPayoutBootInvariants(options);
  const mode = options.mode ?? 'manual';
  const client = options.client;
  const cycleDays = options.cycleDays ?? 7;
  const now = options.now ?? (() => new Date());
  const batchOptions = { capVnd: options.capVnd, holdsEnabled: options.holdsEnabled, risk: options.risk };

  const actorOf = (req: FastifyRequest): Actor => req.actor!;

  /**
   * The finance role, read from the row and not from the token. A token is
   * signed once at login; a role revoked this morning must bite this
   * afternoon, so it costs one lookup per request that asks.
   */
  const requireFinance = financeGuard(db);

  /**
   * Every route on this lane, read or write. There was a second option,
   * `read = { preHandler: requireActor }`, and it was wrong: measured, a plain
   * counter operator at an unrelated centre got 200 on a collector's bank
   * code, account last four, declared and verified name, their income and the
   * whole period's batch of bills. None of that is public to an operator
   * session, so the reads carry the same guard as the writes and there is one
   * list to keep.
   */
  const finance = { preHandler: [requireActor, requireFinance] };
  /**
   * The counter operator's own guard: any operator session, no finance role.
   * Exactly one route uses it — declaring a collector's payout account at the
   * counter — and that route scopes itself to the operator's centre and hands
   * back only masked forms, which is why it is not on the finance list with
   * everything else on this lane.
   */
  const counter = { preHandler: requireActor };

  async function guarded<T>(
    run: () => Promise<T | undefined>,
  ): Promise<{ ok: true; value: T | undefined } | { ok: false; constraint: string }> {
    try {
      return { ok: true, value: await run() };
    } catch (err) {
      const name = constraintOf(err);
      if (name !== undefined && PAYOUT_REFUSALS.has(name)) return { ok: false, constraint: name };
      throw err;
    }
  }

  const refused = (reply: Reply, constraint: string) => reply.code(409).send({ error: 'refused', constraint });

  const pathId = (req: FastifyRequest): string | null => {
    const parsed = uuid.safeParse((req.params as { id?: string }).id);
    return parsed.success ? parsed.data : null;
  };

  /**
   * `:period` is the period start — a date (`2026-08-17`) or an instant — and
   * the end is `?period_end=` or one cycle later, the same rule `settle.ts`
   * applies. Bills are those whose `period_start` falls inside.
   */
  const periodOf = (req: FastifyRequest): { start: Date; end: Date } | string => {
    const raw = (req.params as { period?: string }).period ?? '';
    const start = new Date(raw);
    if (Number.isNaN(start.getTime())) return 'period must be a date';
    const q = (req.query as Record<string, string | undefined>)['period_end'];
    const end = q === undefined ? new Date(start.getTime() + cycleDays * 24 * 60 * 60 * 1000) : new Date(q);
    if (Number.isNaN(end.getTime())) return 'period_end must be a date';
    if (end.getTime() <= start.getTime()) return 'the period ends before it starts';
    return { start, end };
  };

  const shapeBill = (b: BatchBill) => ({
    id: b.id,
    collector_id: b.collectorId,
    collector_ref: b.collectorRef,
    period_start: b.periodStart.toISOString(),
    period_end: b.periodEnd.toISOString(),
    currency: b.currency,
    total: b.total,
    amount_vnd: b.amountVnd,
    lines: b.lineCount,
    paid: b.paid,
    account:
      b.account === null
        ? null
        : {
            id: b.account.id,
            method: b.account.method,
            verify_status: b.account.verifyStatus,
            declared_name: b.account.declaredName,
            verified_name: b.account.verifiedName,
            phone_masked: b.account.phoneMasked,
          },
    attempt:
      b.latestAttempt === null
        ? null
        : {
            id: b.latestAttempt.id,
            seq: b.latestAttempt.attemptSeq,
            partner_order_id: b.latestAttempt.partnerOrderId,
            mode: b.latestAttempt.mode,
            status: b.latestAttempt.status,
            zlp_order_id: b.latestAttempt.zlpOrderId,
            zp_trans_id: b.latestAttempt.zpTransId,
            sub_return_code: b.latestAttempt.subReturnCode,
            manual_reference: b.latestAttempt.manualReference,
            poll_count: b.latestAttempt.pollCount,
            last_polled_at: b.latestAttempt.lastPolledAt?.toISOString() ?? null,
            created_at: b.latestAttempt.createdAt.toISOString(),
            settled_at: b.latestAttempt.settledAt?.toISOString() ?? null,
          },
    risk: b.risk,
    issues: b.issues,
  });

  // -------------------------------------------------------------------------
  // Accounts: declare, and verify on declare (BUILD 5)

  /**
   * The ZaloPay page an account's verification pointed the collector at, if
   * any. Kept on the event rather than the account because the §2.1 contract
   * has no column for it, and the event is the evidence anyway.
   */
  const redirectFor = async (accountId: string): Promise<{ onboarding_url: string | null; reform_url: string | null }> => {
    const [row] = await db
      .select({ kind: schema.payoutEvents.kind, evidence: schema.payoutEvents.evidence })
      .from(schema.payoutEvents)
      .where(sql`${schema.payoutEvents.payoutAccountId} = ${accountId} and ${schema.payoutEvents.kind} in ('IDENT.NO_WALLET', 'IDENT.KYC_LIMIT')`)
      .orderBy(sql`${schema.payoutEvents.id} desc`)
      .limit(1);
    const url = ((row?.evidence as { redirect_url?: string | null } | undefined)?.redirect_url) ?? null;
    return {
      onboarding_url: row?.kind === 'IDENT.NO_WALLET' ? url : null,
      reform_url: row?.kind === 'IDENT.KYC_LIMIT' ? url : null,
    };
  };

  type AccountRow = typeof schema.payoutAccounts.$inferSelect;
  type AccountInput = z.infer<typeof AccountBody>;

  /** Every stable field the table stores, compared as stored. */
  const sameDeclaration = (held: AccountRow, b: AccountInput, last4: string | null): boolean =>
    held.collectorId === b.collector_id &&
    held.method === b.method &&
    held.phone === (b.phone ?? null) &&
    held.bankCode === (b.bank_code ?? null) &&
    held.accountNoLast4 === last4 &&
    held.declaredName === b.declared_name;

  const replayed = async (held: AccountRow) => {
    const redirect = await redirectFor(held.id);
    return {
      id: held.id,
      replayed: true,
      method: held.method,
      verify_status: held.verifyStatus,
      declared_name: held.declaredName,
      verified_name: held.verifiedName,
      account_no_last4: held.accountNoLast4,
      phone_masked: maskPhone(held.phone),
      onboarding_url: redirect.onboarding_url,
      reform_url: redirect.reform_url,
      is_current: held.isCurrent,
    };
  };

  /**
   * Is money already moving to this collector?
   *
   * `payout_accounts_current_key` allows one current account, so declaring a
   * new one silently demotes the account an open attempt is paying. Nothing
   * about the transfer changes — ZaloPay has the old destination — but the
   * screen would then show the new one, which is the console telling an
   * operator that money in flight is going somewhere it is not. Refused by
   * name on BOTH routes: the finance route can do it today, and moving the
   * declaration to the counter without this guard would only widen it.
   *
   * Open is "not terminal", from the same `TERMINAL` the state machine uses,
   * so an attempt parked in `pending_zlp` locks the declaration until an
   * operator resolves it. That is the intended order: say what happened to the
   * payment first, then change where the next one goes.
   */
  const payingNow = async (collectorId: string): Promise<boolean> => {
    const held = (await db.execute(sql`
      select 1 from payout_attempts a
        join bills b on b.id = a.bill_id
       where b.collector_id = ${collectorId}
         and a.status not in (${sql.join([...TERMINAL].map((s) => sql`${s}`), sql`, `)})
       limit 1
    `)) as unknown as unknown[];
    return held.length > 0;
  };

  type Declared =
    | { kind: 'refused'; constraint: string }
    | { kind: 'replayed'; body: Record<string, unknown> }
    | { kind: 'created'; body: Record<string, unknown> };

  /**
   * Declaring an account, once, for both callers: the finance route below and
   * the counter route under `/collectors/:id/accounts`. One body, because the
   * two differ in who may call them and in where the collector id comes from,
   * and in nothing else — a second copy of the replay rules and the verify
   * ordering is a second copy that goes stale.
   */
  const declareAccount = async (actor: Actor, b: AccountInput): Promise<Declared> => {
    const last4 = b.account_no === undefined ? null : b.account_no.slice(-4);

    /**
     * The id decides first, and it decides BEFORE ZaloPay is asked (bridge
     * review F-40). A replay is the same destination under the same id —
     * every stable field this table stores has to agree, not just the
     * collector and the method — and costs nothing. A different phone, bank
     * code, account number or holder name under a used id is not a retry, it
     * is a correction wearing a used id, and answering "replayed" would tell
     * the caller their corrected destination was stored when payouts still
     * point at the old one. It is refused, and ZaloPay is never contacted
     * about a destination that will not be stored.
     */
    const existing = await db.select().from(schema.payoutAccounts).where(eq(schema.payoutAccounts.id, b.id));
    if (existing[0] !== undefined) {
      if (!sameDeclaration(existing[0], b, last4)) return { kind: 'refused', constraint: 'payout_accounts_id_reused' };
      return { kind: 'replayed', body: await replayed(existing[0]) };
    }

    /** Checked after the replay, so a retry of a lost reply is still a replay and not a refusal. */
    if (await payingNow(b.collector_id)) return { kind: 'refused', constraint: 'payout_account_locked_while_paying' };

    /**
     * Verify BEFORE the transaction, so the outcome is written once with the
     * row: `payout_accounts_append_only` allows no later correction, and the
     * declaration and ZaloPay's answer to it are one piece of evidence.
     */
    const receiver: VerifyReceiver =
      b.method === 'WALLET'
        ? { method: 'WALLET', phone: b.phone! }
        : b.method === 'BANK_ACCOUNT'
          ? { method: 'BANK_ACCOUNT', bankCode: b.bank_code!, accountNo: b.account_no!, accountHolderName: b.declared_name }
          : { method: 'BANK_CARD', bankCode: b.bank_code!, cardNo: b.account_no!, cardHolderName: b.declared_name };
    const outcome = await verifyDeclaration(client, b.declared_name, receiver);
    const verifiedAt = outcome.status === 'unverified' ? null : now();

    /** What is audited: no full account number, no full phone. Rule 1 of §2.5. */
    const after = {
      collector_id: b.collector_id,
      method: b.method,
      phone_masked: b.phone === undefined ? null : maskPhone(b.phone),
      bank_code: b.bank_code ?? null,
      account_no_last4: last4,
      declared_name: b.declared_name,
      verified_name: outcome.verifiedName,
      verify_status: outcome.status,
      sub_return_code: outcome.subCode,
    };

    const attempt = await guarded(() =>
      mutate(
        db,
        actor,
        { action: 'payout_account.declare', targetTable: 'payout_accounts', targetId: b.id, after },
        async (tx) => {
          const taken = await tx
            .select({ id: schema.payoutAccounts.id })
            .from(schema.payoutAccounts)
            .where(eq(schema.payoutAccounts.id, b.id));
          if (taken.length > 0) return undefined;

          // The predecessor stops being current in the same transaction as
          // its successor starts; `payout_accounts_current_key` holds in between.
          await tx
            .update(schema.payoutAccounts)
            .set({ isCurrent: false })
            .where(sql`${schema.payoutAccounts.collectorId} = ${b.collector_id} and ${schema.payoutAccounts.isCurrent}`);

          const [row] = await tx
            .insert(schema.payoutAccounts)
            .values({
              id: b.id,
              collectorId: b.collector_id,
              method: b.method,
              phone: b.phone ?? null,
              bankCode: b.bank_code ?? null,
              accountNoLast4: last4,
              declaredName: b.declared_name,
              verifiedName: outcome.verifiedName,
              /** Wallet-only by the contract; a client answering one on a bank route is ignored, not stored. */
              mUId: b.method === 'WALLET' ? outcome.mUId : null,
              verifyStatus: outcome.status,
              verifiedAt,
              isCurrent: true,
              createdBy: (actor as CounterActor).operator.operatorId,
            })
            .returning();
          if (row === undefined) return undefined;

          if (outcome.event !== null) {
            await emitEvent(tx, {
              kind: outcome.event,
              collectorId: b.collector_id,
              payoutAccountId: b.id,
              evidence: {
                method: b.method,
                declared_name: b.declared_name,
                verified_name: outcome.verifiedName,
                sub_return_code: outcome.subCode,
                redirect_url: outcome.redirectUrl,
                phone_masked: after.phone_masked,
              },
            });
          }
          return row;
        },
      ),
    );
    if (!attempt.ok) return { kind: 'refused', constraint: attempt.constraint };
    if (attempt.value === undefined) {
      /**
       * Nothing was written because the id landed between the read above and
       * the transaction — the same request twice, at once. Same rule as
       * above: the same declaration is a replay, anything else is refused.
       */
      const [held] = await db.select().from(schema.payoutAccounts).where(eq(schema.payoutAccounts.id, b.id));
      if (held === undefined || !sameDeclaration(held, b, last4)) {
        return { kind: 'refused', constraint: 'payout_accounts_id_reused' };
      }
      return { kind: 'replayed', body: await replayed(held) };
    }
    /**
     * The shape the collector app (Agent E) reads: the status, both names side
     * by side, the last four digits and nothing more of the account, and the
     * ZaloPay page to open when there is one — `onboarding_url` for -101,
     * `reform_url` for -406. Never a dead end, never a full identifier.
     */
    return {
      kind: 'created',
      body: {
        id: b.id,
        replayed: false,
        method: b.method,
        verify_status: outcome.status,
        declared_name: b.declared_name,
        verified_name: outcome.verifiedName,
        account_no_last4: last4,
        phone_masked: after.phone_masked,
        onboarding_url: outcome.subCode === -101 ? outcome.redirectUrl : null,
        reform_url: outcome.subCode === -406 ? outcome.redirectUrl : null,
        sub_return_code: outcome.subCode,
      },
    };
  };

  const sendDeclared = (reply: Reply, out: Declared) =>
    out.kind === 'refused'
      ? refused(reply, out.constraint)
      : reply.code(out.kind === 'created' ? 201 : 200).send(out.body);

  app.post('/api/payout/accounts', finance, async (req, reply) => {
    const body = AccountBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    return sendDeclared(reply, await declareAccount(actorOf(req), body.data));
  });

  /**
   * The counter's declaration (WAVE 1). The operator declares the account at
   * the counter on the collector's behalf, exactly as they already create the
   * handover and the session.
   *
   * Why not a collector-facing route: there is no collector credential in this
   * service — every `APP-*` item is blocked on PaXini — so a route "for the
   * collector" would have nothing to authenticate and would be an operator
   * route wearing a different name. The measured consequence of leaving
   * declaration finance-only is a collector approved and awaiting payment for
   * ever, with nobody in the room able to fix it.
   *
   * Scope, the same shape as `/handovers/:id/sessions` and
   * `/episodes/:id/resolve`: the collector must have handed a card in at THIS
   * centre. A collector has no centre of their own (`collectors` carries no
   * `upload_centre_id`), and the handover is what puts a person in front of an
   * operator. Anyone else is `payout_account_not_this_centre`, which is also
   * the answer for a collector id that exists nowhere — the two are the same
   * fact to an operator, and telling them apart would say whether a stranger's
   * id is real.
   *
   * The collector comes from the path and never from the body, the same rule
   * `counter.ts` states for the centre: a console that asks to declare
   * somebody else's account is not refused a field, it is simply not consulted.
   */
  app.post('/api/payout/collectors/:id/accounts', counter, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    const actor = actorOf(req) as CounterActor;

    const [seen] = await db
      .select({ id: schema.handovers.id })
      .from(schema.handovers)
      .where(
        and(
          eq(schema.handovers.collectorId, id),
          eq(schema.handovers.uploadCentreId, actor.operator.uploadCentreId),
        ),
      )
      .limit(1);
    if (seen === undefined) return refused(reply, 'payout_account_not_this_centre');

    /**
     * A named refusal rather than the 400 the finance route answers. This one
     * is typed by a person at a counter, and `payout_account_declaration_invalid`
     * is a sentence in their language; a list of Zod issues is not. Only the
     * constraint is sent, because the console reads `detail ?? constraint` and
     * a detail would shadow the name.
     */
    const body = AccountBody.safeParse({ ...(req.body as Record<string, unknown>), collector_id: id });
    if (!body.success) return refused(reply, 'payout_account_declaration_invalid');

    return sendDeclared(reply, await declareAccount(actor, body.data));
  });

  /**
   * The income screen (Agent E, BUILD 4): server-computed values only,
   * rendered as received. One entry per bill, and one for the work reviewed
   * but not yet billed. `withheld` is 0 and `net` is `gross` as stored until
   * the PIT rate is decided — the same rule as the export, and for the same
   * reason: nothing outside `settle.ts` computes a figure.
   *
   * Status vocabulary, as the app expects it:
   *   pending_review   settlements not yet on a bill
   *   approved         billed, not yet paid ("Đã duyệt, chờ chi trả")
   *   paid             a terminal-succeeded attempt, or every line manually_paid
   *   on_hold          a risk hold on the bill, while holds are enabled, OR a
   *                    line on the bill parked in `exception` (0016). The app
   *                    shows a neutral state and never the reasons.
   *
   * A parked line has to land in `on_hold` and not `approved`. Neither payout
   * rail will pay a bill that has one — `refusalFor` answers
   * `payout_settlement_exception` before it asks about the total or the
   * account — so `approved`, which the app prints as "Đã duyệt, chờ chi trả",
   * would tell a collector their money is on its way when an operator has
   * stopped it. `on_hold` is the existing neutral bucket and carries no reason
   * code and no note, which is what a collector must not be shown: the reason
   * may name another collector (`wrong_collector`) or an internal judgement
   * (`disputed`, `manual_hold`), and the free-text note is evidence.
   *
   * There is no collector credential in this service yet (APP-* is blocked
   * on PaXini), so this is addressed by collector id under the operator
   * session; the app's server-side proxy maps `GET /api/payout/income` onto it.
   */
  app.get('/api/payout/collectors/:id/income', finance, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    const [collector] = await db.select({ id: schema.collectors.id }).from(schema.collectors).where(eq(schema.collectors.id, id));
    if (collector === undefined) return reply.code(404).send({ error: 'no such collector' });

    const risk = options.risk;
    const bills = (await db.execute(sql`
      select b.id, b.period_start, b.period_end, b.total::text as total,
             (select coalesce(sum(s.effective_minutes), 0)::text
                from bill_lines l join settlements s on s.id = l.settlement_id
               where l.bill_id = b.id) as minutes,
             (select bool_and(s.settlement_state = 'manually_paid')
                from bill_lines l join settlements s on s.id = l.settlement_id
               where l.bill_id = b.id) as all_paid,
             (select bool_or(s.settlement_state = 'exception')
                from bill_lines l join settlements s on s.id = l.settlement_id
               where l.bill_id = b.id) as parked
        from bills b
       where b.collector_id = ${id}
       order by b.period_start desc
    `)) as unknown as { id: string; period_start: Date; period_end: Date; total: string; minutes: string; all_paid: boolean | null; parked: boolean | null }[];

    const periods: Record<string, unknown>[] = [];
    for (const b of bills) {
      const attempt = await latestAttemptOf(db, b.id);
      const summary = risk === undefined ? null : await risk.billSummary(b.id);
      const paid = (b.all_paid ?? false) || attempt?.status === 'succeeded';
      const held = (options.holdsEnabled === true && summary?.band === 'hold') || b.parked === true;
      periods.push({
        bill_id: b.id,
        period_start: new Date(b.period_start).toISOString(),
        period_end: new Date(b.period_end).toISOString(),
        valid_minutes: b.minutes,
        gross: b.total,
        withheld: '0',
        net: b.total,
        status: paid ? 'paid' : held ? 'on_hold' : 'approved',
      });
    }

    const [pending] = (await db.execute(sql`
      select count(*)::int as n,
             coalesce(sum(s.effective_minutes), 0)::text as minutes,
             coalesce(sum(s.amount), 0)::text as gross,
             min(s.created_at) as first_at, max(s.created_at) as last_at
        from settlements s
        join episode_reviews r on r.id = s.episode_review_id
        join episodes e on e.episode_id = r.episode_id
        join collection_sessions c on c.id = e.collection_session_id
       where c.collector_id = ${id}
         and s.settlement_state in ('pending_review', 'pending_settlement')
    `)) as unknown as { n: number; minutes: string; gross: string; first_at: Date | null; last_at: Date | null }[];
    if (pending !== undefined && pending.n > 0) {
      periods.unshift({
        bill_id: null,
        period_start: new Date(pending.first_at!).toISOString(),
        period_end: new Date(pending.last_at!).toISOString(),
        valid_minutes: pending.minutes,
        gross: pending.gross,
        withheld: '0',
        net: pending.gross,
        status: 'pending_review',
      });
    }
    return { collector_id: id, currency: 'VND', periods };
  });

  app.get('/api/payout/collectors/:id/accounts', finance, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    const rows = await db
      .select()
      .from(schema.payoutAccounts)
      .where(eq(schema.payoutAccounts.collectorId, id))
      .orderBy(sql`${schema.payoutAccounts.createdAt} desc`);
    const accounts = [];
    for (const a of rows) {
      accounts.push({
        id: a.id,
        method: a.method,
        phone_masked: maskPhone(a.phone),
        bank_code: a.bankCode,
        account_no_last4: a.accountNoLast4,
        declared_name: a.declaredName,
        verified_name: a.verifiedName,
        verify_status: a.verifyStatus,
        verified_at: a.verifiedAt?.toISOString() ?? null,
        is_current: a.isCurrent,
        created_at: a.createdAt.toISOString(),
        ...(await redirectFor(a.id)),
      });
    }
    return { accounts };
  });

  // -------------------------------------------------------------------------
  // Batches: the period's bills, and the preflight

  app.get('/api/payout/batches/:period', finance, async (req, reply) => {
    const period = periodOf(req);
    if (typeof period === 'string') return reply.code(422).send({ error: period });
    const bills = await loadBatch(db, period, batchOptions);
    return reply.send({
      period_start: period.start.toISOString(),
      period_end: period.end.toISOString(),
      mode,
      bills: bills.map(shapeBill),
    });
  });

  app.post('/api/payout/batches/:period/preflight', finance, async (req, reply) => {
    const period = periodOf(req);
    if (typeof period === 'string') return reply.code(422).send({ error: period });
    const { billsDetail, ...result } = await preflight(db, client, period, batchOptions);
    return reply.send({
      ...result,
      mode,
      /** The ones an operator has to look at, by name and with why. */
      exceptions: billsDetail.filter((b) => b.issues.length > 0).map(shapeBill),
    });
  });

  /**
   * The batch, as one request (bridge review F-46: the console never loops
   * pay in the browser). Preflight over the whole period, refuse all if the
   * balance is short, then one transfer at a time, stopping at the first
   * failure — `runBatch`, inside the request, and its report rendered.
   *
   * One run per period at a time. A transaction-scoped advisory lock keyed on
   * the period is taken in a transaction that WRITES NOTHING and is held for
   * the run; a second caller gets `false` and 409 `payout_batch_running`,
   * immediately, rather than queueing behind the first and sending nothing
   * an hour later. Transaction-scoped rather than session-scoped because the
   * pool may hand the release to another connection. That holder is one
   * connection for the run's duration while every write opens its own, so
   * the pool must be at least two — `serve.ts` opens ten. A pool of one
   * would wait forever here.
   *
   * The lock transaction writes nothing on purpose (bridge finding
   * payout.ts:606): the run is not atomic, so nothing about it may be. The
   * attempts commit one at a time inside `payBill`; the audit is two rows in
   * their own transactions — `payout.batch_run.started` once the lock is
   * held, and `payout.batch_run` with the report when the loop ends, whether
   * it ended by itself or by a throw. A throw after transfer K therefore
   * leaves attempts 1..K and both audit rows standing, and answers 500 with
   * the partial report. A process that dies mid-loop leaves the started row
   * with no report row, which is what "look at payout_attempts" means; the
   * lock dies with the connection, so the next call is not 409 forever.
   * A batch-run table with a running state and a heartbeat would say the
   * same thing with a migration and a staleness rule; not worth it yet.
   *
   * Safe to call twice: the second run finds nothing payable and sends
   * nothing, and `payout_attempts_guard` would refuse a second attempt if it
   * did. Tested against the stub's transfer count.
   */
  app.post('/api/payout/batches/:period/run', finance, async (req, reply) => {
    const period = periodOf(req);
    if (typeof period === 'string') return reply.code(422).send({ error: period });
    if (mode !== 'api') return refused(reply, 'payout_mode_manual');

    const key = `payout_batch_run:${period.start.toISOString()}/${period.end.toISOString()}`;
    const actor = actorOf(req);
    const audit = (action: string, after: Record<string, unknown>) =>
      mutate(db, actor, { action, targetTable: 'bills', targetId: key, after }, async () => true);
    const periodJson = { period_start: period.start.toISOString(), period_end: period.end.toISOString() };

    const outcome = await db.transaction(async (tx): Promise<'running' | { run: BatchRun; error: string | null }> => {
      const [lock] = (await tx.execute(
        sql`select pg_try_advisory_xact_lock(hashtext(${key})) as taken`,
      )) as unknown as { taken: boolean }[];
      if (lock?.taken !== true) return 'running';
      await audit('payout.batch_run.started', periodJson);
      let run: BatchRun;
      let error: string | null = null;
      try {
        run = await runBatch(db, client, actor, period, batchOptions);
      } catch (err) {
        if (!(err instanceof BatchAborted)) throw err;
        run = err.run;
        error = err.message;
      }
      await audit('payout.batch_run', {
        ...periodJson,
        preflight_ok: run.preflight.ok,
        refusal: run.preflight.refusal,
        total_vnd: run.preflight.total_vnd,
        balance_vnd: run.preflight.balance_vnd,
        sent: run.sent.map((s) => ({ bill_id: s.billId, attempt_id: s.attemptId, status: s.status })),
        refused: run.refused.map((r) => ({ bill_id: r.billId, constraint: r.constraint })),
        stopped_at: run.stopped_at?.billId ?? null,
        error,
      });
      return { run, error };
    });
    if (outcome === 'running') return refused(reply, 'payout_batch_running');
    const { run, error } = outcome;
    const report = {
      ...periodJson,
      mode,
      preflight: run.preflight,
      sent: run.sent.map((s) => ({
        bill_id: s.billId,
        attempt_id: s.attemptId,
        partner_order_id: s.partnerOrderId,
        status: s.status,
        result: s.result,
      })),
      refused: run.refused.map((r) => ({ bill_id: r.billId, collector_ref: r.collectorRef, constraint: r.constraint })),
      stopped_at: run.stopped_at?.billId ?? null,
      tickets: run.tickets.map((t) => ({ kind: t.kind, bill_id: t.billId, evidence: t.evidence, occurred_at: t.occurredAt })),
    };
    if (error !== null) return reply.code(500).send({ error: 'payout_batch_aborted', message: error, ...report });
    return reply.send(report);
  });

  // -------------------------------------------------------------------------
  // Pay: the API rail (BUILD 4, 8)

  app.post('/api/payout/bills/:id/pay', finance, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    if (mode !== 'api') return refused(reply, 'payout_mode_manual');

    const loaded = await loadBill(db, id, batchOptions);
    if (loaded === undefined) return reply.code(404).send({ error: 'no such bill' });

    const outcome = await guarded(() => payBill(db, client, actorOf(req), loaded, batchOptions));
    if (!outcome.ok) return refused(reply, outcome.constraint);
    const o = outcome.value!;
    if (o.kind === 'refused') return refused(reply, o.constraint);
    return reply.code(201).send({
      bill_id: id,
      attempt_id: o.attempt.id,
      partner_order_id: o.attempt.partnerOrderId,
      status: o.attempt.status,
      zlp_order_id: o.attempt.zlpOrderId,
      sub_return_code: o.attempt.subReturnCode,
      result: o.result,
    });
  });

  // -------------------------------------------------------------------------
  // Mark paid: the manual rail (SET-03 with a finance role and a reference)

  app.post('/api/payout/bills/:id/mark-paid', finance, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    const body = MarkPaidBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const b = body.data;

    const [bill] = await db.select().from(schema.bills).where(eq(schema.bills.id, id));
    if (bill === undefined) return reply.code(404).send({ error: 'no such bill' });

    /**
     * The same gate as the API rail, immediately before the transaction
     * (bridge review F-41). This is the DEFAULT pilot rail, so it is the one
     * that can actually record an unverified or name-mismatched destination,
     * a held bill or an over-cap bill as paid — unless it asks the same
     * questions `payBill` asks. `refusalFor` is those questions, in one
     * place; the trigger asks the verification one again in SQL.
     */
    const loaded = await loadBill(db, id, batchOptions);
    if (loaded === undefined) return reply.code(404).send({ error: 'no such bill' });
    const gate = await refusalFor(db, loaded, batchOptions);
    if (gate !== null) return refused(reply, gate);
    const account = loaded.account!;

    const attemptId = randomUUID();
    const settledAt = now();
    const before: { settlement_states: [string, string][] } = { settlement_states: [] };

    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: 'bill.mark_paid',
          targetTable: 'payout_attempts',
          targetId: attemptId,
          before,
          after: {
            bill_id: id,
            amount_vnd: b.amount_vnd,
            manual_reference: b.manual_reference,
            total: bill.total,
          },
        },
        async (tx) => {
          /**
           * The attempt first: the triggers decide whether this bill may be
           * paid at all (previous attempt not failed, amount not the total,
           * total not whole dong) before a single settlement moves.
           */
          const row = await insertAttempt(tx, {
            id: attemptId,
            billId: id,
            payoutAccountId: account.id,
            amountVnd: b.amount_vnd,
            mode: 'manual',
            manualReference: b.manual_reference,
            settledAt,
          });
          const lines = (await tx.execute(sql`
            select s.id, s.settlement_state
              from bill_lines l join settlements s on s.id = l.settlement_id
             where l.bill_id = ${id}
             order by s.id
          `)) as unknown as { id: string; settlement_state: string }[];
          before.settlement_states = lines.map((l) => [l.id, l.settlement_state]);
          /**
           * `bill_generated` in the WHERE, as `settle.ts` does: a line somebody
           * moved to `exception` in between is not matched, and the count
           * disagrees, and the whole transaction — attempt included — rolls back.
           */
          const moved = (await tx.execute(sql`
            update settlements
               set settlement_state = 'manually_paid', updated_at = now()
             where id in (select settlement_id from bill_lines where bill_id = ${id})
               and settlement_state = 'bill_generated'
            returning id
          `)) as unknown as { id: string }[];
          if (moved.length !== lines.length) {
            throw new Error('a settlement on this bill is no longer bill_generated');
          }
          return row;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    const row = attempt.value!;
    return reply.code(201).send({
      bill_id: id,
      attempt_id: row.id,
      partner_order_id: row.partnerOrderId,
      status: row.status,
      amount_vnd: row.amountVnd,
      manual_reference: row.manualReference,
      settled_at: row.settledAt?.toISOString() ?? null,
    });
  });

  // -------------------------------------------------------------------------
  // Resolve: the one way out of pending_zlp, and out of an exhausted unknown

  app.post('/api/payout/attempts/:id/resolve', finance, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    const body = ResolveBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid body', detail: body.error.issues });
    const b = body.data;

    const held = await attemptById(db, id);
    if (held === null) return reply.code(404).send({ error: 'no such attempt' });

    let illegal: IllegalTransition | null = null;
    const attempt = await guarded(() =>
      mutate(
        db,
        actorOf(req),
        {
          action: 'payout_attempt.resolve',
          targetTable: 'payout_attempts',
          targetId: id,
          before: { status: held.status },
          after: { status: b.outcome, zp_trans_id: b.zp_trans_id ?? null },
          /** Required by `payout_attempts_pending_resolved`: the typed reason IS the permission. */
          reason: b.reason,
        },
        async (tx) => {
          const moved = await applyEvent(
            tx,
            held,
            { type: 'OPERATOR_RESOLVE', reason: b.reason, outcome: b.outcome },
            { zpTransId: b.zp_trans_id ?? null },
          );
          if (moved instanceof IllegalTransition) {
            illegal = moved;
            return undefined;
          }
          return moved?.attempt;
        },
      ),
    );
    if (!attempt.ok) return refused(reply, attempt.constraint);
    if (illegal !== null) {
      return reply.code(409).send({ error: 'refused', constraint: 'payout_attempt_not_resolvable', detail: (illegal as IllegalTransition).message });
    }
    if (attempt.value === undefined) return reply.code(409).send({ error: 'refused', constraint: 'payout_attempt_not_resolvable' });
    return reply.send({
      attempt_id: id,
      status: attempt.value.status,
      zp_trans_id: attempt.value.zpTransId,
      settled_at: attempt.value.settledAt?.toISOString() ?? null,
    });
  });

  app.get('/api/payout/attempts/:id', finance, async (req, reply) => {
    const id = pathId(req);
    if (id === null) return reply.code(400).send({ error: 'invalid id' });
    const row = await attemptById(db, id);
    if (row === null) return reply.code(404).send({ error: 'no such attempt' });
    const events = await db
      .select()
      .from(schema.payoutEvents)
      .where(eq(schema.payoutEvents.payoutAttemptId, id))
      .orderBy(schema.payoutEvents.id);
    return {
      ...row,
      lastPolledAt: row.lastPolledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      settledAt: row.settledAt?.toISOString() ?? null,
      events: events.map((e) => ({ kind: e.kind, evidence: e.evidence, occurred_at: e.occurredAt.toISOString() })),
    };
  });

  // -------------------------------------------------------------------------
  // Export: the CSV, hashed and recorded (BUILD 6). EXPORT ONLY.

  app.get('/api/payout/export/:period', finance, async (req, reply) => {
    const period = periodOf(req);
    if (typeof period === 'string') return reply.code(422).send({ error: period });
    const bills = await loadBatch(db, period, batchOptions);

    const rows: ExportRow[] = [];
    for (const b of bills) {
      /**
       * Copied from the settlements on the lines, as stored. The minutes are
       * summed and the prices listed; nothing here multiplies anything.
       * A bill whose lines carry more than one unit price reports `mixed`,
       * because a single rate would be a figure nobody was paid at.
       */
      const lines = (await db.execute(sql`
        select s.unit_price::text as unit_price, s.effective_minutes::text as effective_minutes
          from bill_lines l join settlements s on s.id = l.settlement_id
         where l.bill_id = ${b.id}
         order by s.id
      `)) as unknown as { unit_price: string; effective_minutes: string }[];
      const minutes = (await db.execute(sql`
        select coalesce(sum(s.effective_minutes), 0)::text as minutes
          from bill_lines l join settlements s on s.id = l.settlement_id
         where l.bill_id = ${b.id}
      `)) as unknown as { minutes: string }[];
      const prices = new Set(lines.map((l) => l.unit_price));
      rows.push({
        bill_id: b.id,
        period_start: b.periodStart.toISOString(),
        period_end: b.periodEnd.toISOString(),
        collector_id: b.collectorId,
        collector_name: b.account?.declaredName ?? '',
        verified_name: b.account?.verifiedName ?? '',
        phone_masked: b.account?.phoneMasked ?? '',
        method: b.account?.method ?? '',
        valid_minutes: minutes[0]!.minutes,
        rate_vnd: prices.size === 1 ? [...prices][0]! : prices.size === 0 ? '' : 'mixed',
        gross_vnd: b.total,
        tax_withheld_vnd: '0',
        net_vnd: b.total,
        episode_count: String(b.lineCount),
        risk_band: b.risk.band,
        risk_flags: b.risk.flags.map((f) => f.signalId).join('|'),
      });
    }
    const built = buildExport(rows);

    const exportId = randomUUID();
    await mutate(
      db,
      actorOf(req),
      {
        action: 'payout.export',
        targetTable: 'payout_exports',
        targetId: exportId,
        after: { period_start: period.start.toISOString(), period_end: period.end.toISOString(), file_hash: built.fileHash, rows: rows.length },
      },
      async (tx) => {
        const [row] = await tx
          .insert(schema.payoutExports)
          .values({
            id: exportId,
            periodStart: period.start,
            periodEnd: period.end,
            fileHash: built.fileHash,
            rowCount: rows.length,
            exportedBy: (actorOf(req) as CounterActor).operator.operatorId,
          })
          .returning({ id: schema.payoutExports.id });
        if (built.rowHashes.length > 0) {
          await tx.insert(schema.payoutExportRows).values(
            built.rowHashes.map((r) => ({ exportId, billId: r.billId, rowHash: r.rowHash })),
          );
        }
        return row;
      },
    );

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('x-playerone-file-hash', built.fileHash)
      .header(
        'content-disposition',
        `attachment; filename="playerone-payout-${period.start.toISOString().slice(0, 10)}.csv"`,
      )
      .send(built.body);
  });
}
