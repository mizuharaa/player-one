/**
 * Exceptions: every attempt that needs a person, every bill that cannot be
 * sent as it is, grouped by what is wrong and with the sentence that says so.
 *
 * The first group is the one the brief is most careful about. An attempt in
 * `pending_zlp` is ZaloPay's status 4: pending inside ZaloPay, fixed only by
 * ZaloPay's own team, and never resolved by retrying. Nothing here retries.
 * The screen says so in words above the list, and the only control is the
 * operator's resolution with a typed reason — which the state machine treats
 * as the permission, and the audit row records.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { Button } from '../components/ui/button.tsx';
import { EmptyState, Panel } from '../components/ui/primitives.tsx';
import { payout, type PayoutBill } from '../lib/api.ts';
import { count, elapsed, vnd, when } from './format.ts';
import { keys } from './period.ts';
import {
  AttemptPill,
  Field,
  IssueList,
  LoadFailed,
  Reason,
  RefusedBanner,
  Select,
  SettleShell,
  TableSkeleton,
} from './pieces.tsx';
import { refusalKey } from './refusals.ts';
import { readOnlyReason, useFinanceRole } from './role.ts';

const POLLING = new Set(['submitted', 'processing', 'unknown']);
const BLOCKING = new Set(['no_account', 'account_unverified', 'total_fractional', 'under_bank_minimum', 'risk_hold']);

export function ExceptionsScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { period } = useSearch({ strict: false }) as { period: string };
  const batch = useQuery({ queryKey: keys.batch(period), queryFn: () => payout.batch(period) });
  /**
   * The limits (ceiling, cap) come from the preflight, read under its own key:
   * this screen must not populate the gate's cache, or visiting the
   * exceptions would count as having read the preflight.
   */
  const pre = useQuery({ queryKey: ['payout', 'limits', period], queryFn: () => payout.preflight(period), staleTime: 5 * 60_000 });
  const [refused, setRefused] = useState<string | null>(null);

  const bills = batch.data?.bills ?? [];
  const pending = bills.filter((b) => b.attempt?.status === 'pending_zlp');
  const polling = bills.filter((b) => b.attempt !== null && POLLING.has(b.attempt.status));
  const neverSent = bills.filter((b) => b.attempt?.status === 'created');
  const ceiling = bills.filter((b) => b.issues.includes('over_bank_ceiling'));
  const cap = bills.filter((b) => b.issues.includes('over_cap'));
  const blocked = bills.filter((b) => !b.paid && b.issues.some((i) => BLOCKING.has(i)));
  const total = pending.length + polling.length + neverSent.length + ceiling.length + cap.length + blocked.length;

  return (
    <SettleShell period={period} tab="exceptions" mode={batch.data?.mode}>
      <p className="mb-4 max-w-[62ch] text-[0.9375rem] leading-relaxed text-[var(--muted-foreground)]">{t('settle.exceptions.intro')}</p>
      <RefusedBanner refusedKey={refused} onDismiss={() => setRefused(null)} />

      {batch.error ? (
        <LoadFailed />
      ) : batch.isPending ? (
        <TableSkeleton />
      ) : total === 0 ? (
        <EmptyState title={t('settle.exceptions.empty')} body={t('settle.exceptions.empty.body')} />
      ) : (
        <div className="space-y-6">
          <Group title={t('settle.exceptions.pending')} body={t('settle.exceptions.pending.body')} bills={pending}>
            {(b) => <AttemptRow bill={b} period={period} resolvable onRefused={setRefused} />}
          </Group>
          <Group title={t('settle.exceptions.polling')} body={t('settle.exceptions.polling.body')} bills={polling}>
            {(b) => <AttemptRow bill={b} period={period} resolvable={b.attempt?.status === 'unknown'} onRefused={setRefused} />}
          </Group>
          <Group title={t('settle.exceptions.neverSent')} body={t('settle.exceptions.neverSent.body')} bills={neverSent}>
            {(b) => <AttemptRow bill={b} period={period} resolvable onlyFailed onRefused={setRefused} />}
          </Group>
          <Group
            title={t('settle.exceptions.ceiling')}
            body={t('settle.exceptions.ceiling.body', { ceiling: vnd(pre.data?.bank_ceiling_vnd ?? 10_000_000, locale) })}
            bills={ceiling}
          >
            {(b) => <BillRow bill={b} period={period} />}
          </Group>
          <Group
            title={t('settle.exceptions.cap')}
            body={pre.data?.cap_vnd ? t('settle.exceptions.cap.body', { cap: vnd(pre.data.cap_vnd, locale) }) : t('settle.preflight.cap.none')}
            bills={cap}
          >
            {(b) => <BillRow bill={b} period={period} />}
          </Group>
          <Group title={t('settle.exceptions.blocked')} body={t('settle.exceptions.blocked.body')} bills={blocked}>
            {(b) => <BillRow bill={b} period={period} />}
          </Group>
        </div>
      )}
    </SettleShell>
  );
}

function Group({ title, body, bills, children }: { title: string; body: string; bills: PayoutBill[]; children: (b: PayoutBill) => ReactNode }) {
  const { i18n } = useTranslation();
  if (bills.length === 0) return null;
  return (
    <Panel className="p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[1.0625rem] font-bold tracking-[-0.01em]">{title}</h2>
        <span className="num text-[0.8125rem] text-[var(--muted-foreground)]">{count(bills.length, i18n.language)}</span>
      </div>
      <p className="mt-1 max-w-[70ch] text-[0.875rem] leading-relaxed text-[var(--muted-foreground)]">{body}</p>
      <ul className="mt-3 divide-y divide-[var(--border)]">
        {bills.map((b) => (
          <li key={b.id} className="py-3">
            {children(b)}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function Head({ bill, period }: { bill: PayoutBill; period: string }) {
  const { t, i18n } = useTranslation();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Link to="/settle/bills/$billId" params={{ billId: bill.id }} search={{ period }} className="num text-[0.9375rem] font-semibold text-[var(--tech-600)]">
        {bill.collector_ref}
      </Link>
      <span className="num text-[0.8125rem] text-[var(--muted-foreground)]">{vnd(bill.amount_vnd, i18n.language)}</span>
      <AttemptPill status={bill.attempt?.status ?? null} />
      {bill.attempt ? <span className="num text-[0.75rem] text-[var(--faint-foreground)]">{bill.attempt.partner_order_id}</span> : null}
      <span className="sr-only">{t('settle.col.open')}</span>
    </div>
  );
}

function BillRow({ bill, period }: { bill: PayoutBill; period: string }) {
  return (
    <div>
      <Head bill={bill} period={period} />
      <IssueList issues={bill.issues} className="mt-2" />
    </div>
  );
}

/* -------------------------------------------------------------------------
   An attempt that needs a person: what is known, its events, and the
   resolution form.
   ---------------------------------------------------------------------- */

function AttemptRow({
  bill,
  period,
  resolvable,
  onlyFailed = false,
  onRefused,
}: {
  bill: PayoutBill;
  period: string;
  resolvable: boolean;
  onlyFailed?: boolean;
  onRefused: (key: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const client = useQueryClient();
  const { role } = useFinanceRole();
  const readOnly = readOnlyReason(role);
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState<'succeeded' | 'failed'>(onlyFailed ? 'failed' : 'succeeded');
  const [reason, setReason] = useState('');
  const [trans, setTrans] = useState('');
  const attempt = bill.attempt!;

  const detail = useQuery({
    queryKey: keys.attempt(attempt.id),
    queryFn: () => payout.attempt(attempt.id),
    enabled: open,
  });

  const resolve = useMutation({
    mutationFn: () =>
      payout.resolve(attempt.id, {
        outcome,
        reason: reason.trim(),
        ...(outcome === 'succeeded' && trans.trim() !== '' ? { zp_trans_id: trans.trim() } : {}),
      }),
    onSuccess: () => {
      onRefused(null);
      void client.invalidateQueries({ queryKey: keys.batch(period) });
      void client.invalidateQueries({ queryKey: keys.preflight(period) });
      void client.invalidateQueries({ queryKey: keys.attempt(attempt.id) });
    },
    onError: (err) => onRefused(refusalKey(err)),
  });

  const inert = readOnly !== null ? t(readOnly) : !resolvable ? t('settle.resolve.pollerWorking') : null;
  const reasonId = `resolve-reason-${attempt.id}`;

  return (
    <div>
      <Head bill={bill} period={period} />
      <p className="num mt-1 text-[0.8125rem] text-[var(--muted-foreground)]">
        {t('settle.exceptions.opened', { elapsed: elapsed(attempt.created_at) })} ·{' '}
        {attempt.poll_count > 0
          ? t('settle.exceptions.polls', { n: count(attempt.poll_count, locale), at: when(attempt.last_polled_at, locale) })
          : t('settle.exceptions.polls.none')}
        {attempt.sub_return_code !== null ? <> · {t('settle.bill.attempt.sub')} {attempt.sub_return_code}</> : null}
      </p>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? t('bo.cancel') : t('settle.resolve.title')}
        </Button>
      </div>

      {open ? (
        <div className="mt-3 grid gap-4 rounded-[var(--radius-base)] bg-[var(--muted)] p-4 lg:grid-cols-2">
          <div>
            <h3 className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]">{t('settle.exceptions.events')}</h3>
            {detail.data ? (
              detail.data.events.length === 0 ? (
                <p className="mt-2 text-[0.8125rem] text-[var(--muted-foreground)]">—</p>
              ) : (
                <ol className="mt-2 space-y-1.5 text-[0.8125rem]">
                  {detail.data.events.map((e, i) => (
                    <li key={i}>
                      <span className="num font-semibold">{e.kind}</span>{' '}
                      <span className="num text-[var(--muted-foreground)]">{when(e.occurred_at, locale)}</span>
                      <span className="num block break-words text-[var(--muted-foreground)]">
                        {Object.entries(e.evidence)
                          .map(([k, v]) => `${k}: ${typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ol>
              )
            ) : (
              <p className="mt-2 text-[0.8125rem] text-[var(--muted-foreground)]">{t('bo.working')}</p>
            )}
          </div>

          {resolve.isSuccess ? (
            <p className="text-[0.9375rem] font-semibold" role="status">
              {t('settle.resolve.done', { status: t(`settle.attempt.${resolve.data?.status ?? 'unknown'}`) })}
            </p>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (inert === null && reason.trim() !== '') resolve.mutate();
              }}
            >
              <Select
                label={t('settle.resolve.outcome')}
                name="outcome"
                value={outcome}
                disabled={inert !== null || onlyFailed}
                onChange={(e) => setOutcome(e.target.value as 'succeeded' | 'failed')}
                options={[
                  ...(onlyFailed ? [] : [{ value: 'succeeded', label: t('settle.resolve.succeeded') }]),
                  { value: 'failed', label: t('settle.resolve.failed') },
                ]}
              />
              <Field
                label={t('settle.resolve.reason')}
                name="reason"
                value={reason}
                disabled={inert !== null}
                onChange={(e) => setReason(e.target.value)}
                hint={t('settle.resolve.reason.hint')}
                required
              />
              {outcome === 'succeeded' ? (
                <Field label={t('settle.resolve.trans')} name="zp_trans_id" value={trans} disabled={inert !== null} onChange={(e) => setTrans(e.target.value)} />
              ) : null}
              <div>
                <Button type="submit" variant="primary" size="sm" disabled={inert !== null || resolve.isPending || reason.trim() === ''} aria-describedby={reasonId}>
                  {resolve.isPending ? t('bo.working') : t('settle.resolve.submit')}
                </Button>
                <Reason id={reasonId}>{inert ?? t('settle.resolve.reason.hint')}</Reason>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </div>
  );
}
