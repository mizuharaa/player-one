/**
 * One bill: what is owed, to whom, what the engine thinks, what has been
 * tried — and, behind the preflight gate, the way to record a payment.
 *
 * The manual flow is the pilot. The operator transfers the money themselves,
 * comes back, types the reference of that transfer and retypes the amount.
 * Both are required by the form, and both are checked by the server: the
 * reference by `payout_attempts_manual_reference_check`, the amount by
 * `payout_attempts_amount_check` against the bill. The screen compares the
 * retyped digits to the figure it was given so the operator learns of a slip
 * before the round trip; it never derives the figure.
 *
 * The API flow, behind `PLAYERONE_PAYOUT_MODE=api`, sends one transfer for
 * this bill through the same gate and the same retype.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button.tsx';
import { Panel, Problem } from '../components/ui/primitives.tsx';
import { IconArrow } from '../components/icons.tsx';
import { payout, type PayoutBill, type PayResult } from '../lib/api.ts';
import { RiskBlock } from '../risk/pieces.tsx';
import { asStored, count, day, vnd, when } from './format.ts';
import { keys } from './period.ts';
import {
  AttemptPill,
  Field,
  Fig,
  IssueList,
  LoadFailed,
  Reason,
  RefusedBanner,
  Section,
  SettleShell,
  TableSkeleton,
  VerifyPill,
} from './pieces.tsx';
import { gateReasonKey, type GateState } from './gate.ts';
import { useGate } from './PreflightScreen.tsx';
import { refusalKey } from './refusals.ts';
import { readOnlyReason, useFinanceRole } from './role.ts';

export function BillScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { period } = useSearch({ strict: false }) as { period: string };
  const { billId } = useParams({ strict: false }) as { billId?: string };
  const batch = useQuery({ queryKey: keys.batch(period), queryFn: () => payout.batch(period) });
  /**
   * The gate reads the cached snapshot only — rendering this screen must not
   * count as running the preflight — and re-evaluates on a ticking clock and
   * on every change to the batch, so it closes in front of the operator.
   */
  const { gate, snapshot, fetchedAt } = useGate(period, batch.data?.bills);
  const [refused, setRefused] = useState<string | null>(null);

  const mode = batch.data?.mode;
  const bill = batch.data?.bills.find((b) => b.id === billId);

  return (
    <SettleShell period={period} tab="bills" mode={mode}>
      <p className="mb-4">
        <Link to="/settle" search={{ period }} className="inline-flex items-center gap-1 text-[0.875rem] font-semibold text-[var(--tech-600)]">
          <IconArrow size={15} className="rotate-180" />
          {t('settle.bill.back')}
        </Link>
      </p>
      <RefusedBanner refusedKey={refused} onDismiss={() => setRefused(null)} />

      {batch.error ? (
        <LoadFailed />
      ) : batch.isPending ? (
        <TableSkeleton />
      ) : bill === undefined ? (
        <Problem title={t('settle.bill.notInPeriod')} body={t('settle.bill.notInPeriod.body')} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
          <div className="space-y-6">
            <Panel className="p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="num text-[1.5rem] font-extrabold tracking-[-0.02em]">{bill.collector_ref}</h2>
                <span className="text-[0.8125rem] text-[var(--muted-foreground)]">
                  {t('settle.bill.period')}: <span className="num">{day(bill.period_start, locale)} – {day(bill.period_end, locale)}</span>
                </span>
              </div>
              <div className="mt-5 grid gap-5 sm:grid-cols-3">
                <Fig label={t('settle.bill.total')} value={asStored(bill.total)} hint={t('settle.asStored', { currency: bill.currency })} />
                <Fig
                  label={t('settle.bill.amount')}
                  value={vnd(bill.amount_vnd, locale)}
                  tone="data"
                  hint={t('settle.wholeVnd')}
                />
                <Fig label={t('settle.col.attempt')} value={<AttemptPill status={bill.attempt?.status ?? null} />} hint={t('settle.lines', { n: count(bill.lines, locale) })} />
              </div>
            </Panel>

            <Panel className="p-5">
              <Section title={t('settle.bill.account')}>
                {bill.account === null ? (
                  <p className="text-[0.9375rem]">{t('settle.bill.account.none')}</p>
                ) : (
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    <Fig label={t('settle.bill.declared')} value={<span className="font-sans">{bill.account.declared_name}</span>} />
                    <Fig
                      label={t('settle.bill.verified')}
                      value={<span className="font-sans">{bill.account.verified_name ?? t('settle.bill.verified.none')}</span>}
                    />
                    <Fig label={t('settle.col.attempt')} value={<VerifyPill status={bill.account.verify_status} />} />
                    <Fig label={t('settle.bill.phone')} value={bill.account.phone_masked || '—'} hint={t(`settle.method.${bill.account.method}`)} />
                  </dl>
                )}
              </Section>
            </Panel>

            <Panel className="p-5">
              <Section title={t('settle.bill.risk')}>
                <RiskBlock summary={bill.risk} period={period} billId={bill.id} />
              </Section>
            </Panel>

            <Panel className="p-5">
              <Section title={t('settle.issue.title')}>
                <IssueList issues={bill.issues} />
              </Section>
            </Panel>

            {bill.attempt ? (
              <Panel className="p-5">
                <Section title={t('settle.bill.attempt')}>
                  <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
                    <Fig label={t('settle.bill.attempt.order')} value={bill.attempt.partner_order_id} />
                    <Fig label={t('settle.col.attempt')} value={<AttemptPill status={bill.attempt.status} />} hint={bill.attempt.mode} />
                    <Fig label={t('settle.bill.attempt.reference')} value={bill.attempt.manual_reference ?? '—'} />
                    <Fig label={t('settle.bill.attempt.zlp')} value={bill.attempt.zlp_order_id ?? '—'} />
                    <Fig label={t('settle.bill.attempt.trans')} value={bill.attempt.zp_trans_id ?? '—'} />
                    <Fig label={t('settle.bill.attempt.sub')} value={bill.attempt.sub_return_code ?? '—'} />
                    <Fig label={t('settle.bill.attempt.polls')} value={count(bill.attempt.poll_count, locale)} hint={when(bill.attempt.last_polled_at, locale)} />
                    <Fig label={t('settle.bill.attempt.created')} value={when(bill.attempt.created_at, locale)} />
                    <Fig label={t('settle.bill.attempt.settled')} value={when(bill.attempt.settled_at, locale)} />
                  </dl>
                </Section>
              </Panel>
            ) : null}
          </div>

          <div>
            <PaymentPanel
              bill={bill}
              period={period}
              mode={mode ?? 'manual'}
              gate={gate}
              preflightOk={snapshot?.ok === true}
              preflightAt={fetchedAt}
              onRefused={setRefused}
            />
          </div>
        </div>
      )}
    </SettleShell>
  );
}

/* -------------------------------------------------------------------------
   The payment panel. Locked until the preflight has been read; every control
   rendered for every role, with its reason when disabled.
   ---------------------------------------------------------------------- */

function PaymentPanel({
  bill,
  period,
  mode,
  gate,
  preflightOk,
  preflightAt,
  onRefused,
}: {
  bill: PayoutBill;
  period: string;
  mode: 'manual' | 'api';
  gate: GateState;
  /** Whether the snapshot said the batch could be sent — the wallet covered it. Gates the API rail only. */
  preflightOk: boolean;
  preflightAt: number;
  onRefused: (key: string | null) => void;
}) {
  const gated = gate.open;
  const gateKey = gateReasonKey(gate);
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const client = useQueryClient();
  const { role } = useFinanceRole();
  const readOnly = readOnlyReason(role);
  const [reference, setReference] = useState('');
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<PayResult | null>(null);

  const done = (r: PayResult | null) => {
    setResult(r);
    onRefused(null);
    void client.invalidateQueries({ queryKey: keys.batch(period) });
    void client.invalidateQueries({ queryKey: keys.preflight(period) });
    void client.invalidateQueries({ queryKey: keys.income(bill.collector_id) });
  };
  const markPaid = useMutation({
    mutationFn: () => payout.markPaid(bill.id, { manual_reference: reference.trim(), amount_vnd: Number(typed) }),
    onSuccess: done,
    onError: (err) => onRefused(refusalKey(err)),
  });
  const pay = useMutation({
    mutationFn: () => payout.pay(bill.id),
    onSuccess: done,
    onError: (err) => onRefused(refusalKey(err)),
  });

  const matches = bill.amount_vnd !== null && typed !== '' && typed === String(bill.amount_vnd);
  const referenced = reference.trim() !== '';
  const busy = markPaid.isPending || pay.isPending;

  /** The reason the whole panel is inert, if it is. First the role, then the gate, then the bill itself. */
  const inert =
    readOnly !== null
      ? t(readOnly)
      : gateKey !== null
        ? t(gateKey)
        : bill.paid
          ? t('settle.pay.alreadyPaid')
          : null;
  /** The API rail additionally needs the snapshot to have said the wallet covers the batch. */
  const apiInert = inert ?? (!preflightOk ? t('settle.batch.noneOk') : null);

  return (
    <Panel className="p-5 lg:sticky lg:top-20">
      <Section title={t('settle.pay.title')}>
        {result ? (
          <p className="mb-4 text-[0.9375rem] font-semibold" role="status">
            {result.manual_reference !== undefined
              ? t('settle.pay.done', { order: result.partner_order_id, status: t(`settle.attempt.${result.status}`) })
              : result.status === 'failed'
                ? t('settle.pay.rejected', { sub: result.sub_return_code ?? '?' })
                : t('settle.pay.sent', { order: result.partner_order_id, status: t(`settle.attempt.${result.status}`) })}
          </p>
        ) : null}

        {!gated && readOnly === null ? (
          <div className="mb-4">
            <Problem
              title={t('settle.pay.locked')}
              body={t(gateKey ?? 'settle.preflight.stale')}
              action={
                <Button asChild variant="primary" size="sm">
                  <Link to="/settle/preflight" search={{ period }}>
                    {t('settle.preflight.open')}
                  </Link>
                </Button>
              }
            />
          </div>
        ) : gated ? (
          <p className="mb-3 text-[0.75rem] text-[var(--faint-foreground)]">
            {t('settle.preflight.ranAt', { at: when(new Date(preflightAt).toISOString(), locale) })}
          </p>
        ) : null}

        <p className="text-[0.875rem] leading-relaxed text-[var(--muted-foreground)]">
          {mode === 'api' ? t('settle.pay.api.intro') : t('settle.pay.manual.intro')}
        </p>

        <form
          className="mt-4 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (inert !== null || busy || !matches) return;
            if (mode === 'api' && !referenced && apiInert === null) pay.mutate();
            else if (referenced) markPaid.mutate();
          }}
        >
          <Field
            label={t('settle.pay.reference')}
            name="reference"
            autoComplete="off"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            disabled={inert !== null}
            hint={t('settle.pay.reference.hint')}
            required={mode === 'manual'}
          />
          <Field
            label={t('settle.pay.retype')}
            name="amount"
            inputMode="numeric"
            pattern="\d+"
            autoComplete="off"
            value={typed}
            onChange={(e) => setTyped(e.target.value.replace(/\D/g, ''))}
            disabled={inert !== null}
            hint={typed !== '' && !matches ? t('settle.pay.mismatch') : t('settle.pay.retype.hint')}
            aria-invalid={typed !== '' && !matches}
            required
          />

          <div className="grid gap-2">
            <Button
              type="submit"
              variant="primary"
              disabled={inert !== null || busy || !matches || !referenced}
              aria-describedby="pay-reason"
            >
              {markPaid.isPending ? t('bo.working') : t('settle.pay.markPaid')}
            </Button>
            {mode === 'api' ? (
              <Button
                type="button"
                variant="secondary"
                disabled={apiInert !== null || busy || !matches}
                aria-describedby="pay-reason"
                onClick={() => pay.mutate()}
              >
                {pay.isPending ? t('bo.working') : t('settle.pay.api.send')}
              </Button>
            ) : null}
            <Reason id="pay-reason">
              {inert ?? apiInert ?? (!referenced ? t('settle.pay.reference.hint') : !matches ? t('settle.pay.retype.hint') : '')}
            </Reason>
          </div>
        </form>
      </Section>
    </Panel>
  );
}
