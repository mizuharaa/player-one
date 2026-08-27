/**
 * Flag review: evidence first, verdict second.
 *
 * The bills of the period, highest risk first. Each opens to its flags — the
 * sentence, then the numbers, then the recordings named — and under them the
 * hold trail: who raised it, who cleared it, when and why, always. The one
 * action an operator has is clearing an open hold with a verdict and a typed
 * reason of at least ten characters, through the engine's own route, which
 * appends a row and never edits one.
 *
 * Escalating and raising a hold by hand have no route on this server. They
 * are rendered disabled with that reason rather than left out, so the shape
 * of the surface is honest about what it will do when the engine grows them.
 *
 * The summaries come from the payout batch route, which carries the §2.3
 * summary for every bill whether or not the engine's own routes are mounted;
 * the trail needs the engine, and a server without it says so.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button.tsx';
import { EmptyState, Panel, Problem } from '../components/ui/primitives.tsx';
import { payout, risk, type ClearVerdict, type PayoutBill } from '../lib/api.ts';
import { count, vnd, when } from '../payout/format.ts';
import { keys } from '../payout/period.ts';
import {
  BandPill,
  Field,
  LoadFailed,
  Reason,
  RefusedBanner,
  Section,
  Select,
  SettleShell,
  TableSkeleton,
} from '../payout/pieces.tsx';
import { isNotOnServer, refusalKey } from '../payout/refusals.ts';
import { readOnlyReason, useFinanceRole } from '../payout/role.ts';
import { FlagCard } from './pieces.tsx';

const VERDICTS: ClearVerdict[] = ['false_positive', 'accepted', 'resolved'];

export function RiskScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const search = useSearch({ strict: false }) as { period: string; bill?: string };
  const period = search.period;
  const [open, setOpen] = useState<string | null>(search.bill ?? null);
  const [refused, setRefused] = useState<string | null>(null);
  const batch = useQuery({ queryKey: keys.batch(period), queryFn: () => payout.batch(period) });

  const ranked = [...(batch.data?.bills ?? [])].sort((a, b) => b.risk.score - a.risk.score);
  const flagged = ranked.filter((b) => b.risk.flags.length > 0 || b.risk.band !== 'clear' || b.id === open);

  return (
    <SettleShell period={period} tab="flags" mode={batch.data?.mode}>
      <p className="mb-4 max-w-[62ch] text-[0.9375rem] leading-relaxed text-[var(--muted-foreground)]">{t('risk.intro')}</p>
      <RefusedBanner refusedKey={refused} onDismiss={() => setRefused(null)} />

      {batch.error ? (
        <LoadFailed />
      ) : batch.isPending ? (
        <TableSkeleton />
      ) : flagged.length === 0 ? (
        <EmptyState title={t('risk.empty')} body={t('risk.empty.body')} />
      ) : (
        <ol className="space-y-3">
          {flagged.map((b) => (
            <li key={b.id}>
              <Panel className="p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Link to="/settle/bills/$billId" params={{ billId: b.id }} search={{ period }} className="num text-[1.0625rem] font-bold text-[var(--tech-600)]">
                    {b.collector_ref}
                  </Link>
                  <BandPill band={b.risk.band} />
                  <span className="num text-[0.8125rem] text-[var(--muted-foreground)]">
                    {t('risk.score')} {b.risk.score} · {t('risk.flags', { n: count(b.risk.flags.length, locale) })} · {vnd(b.amount_vnd, locale)}
                  </span>
                  <Button size="sm" variant={open === b.id ? 'ghost' : 'outline'} className="ml-auto" aria-expanded={open === b.id} onClick={() => setOpen(open === b.id ? null : b.id)}>
                    {open === b.id ? t('bo.cancel') : t('risk.open')}
                  </Button>
                </div>
                {open === b.id ? <Detail bill={b} onRefused={setRefused} period={period} /> : null}
              </Panel>
            </li>
          ))}
        </ol>
      )}
    </SettleShell>
  );
}

function Detail({ bill, period, onRefused }: { bill: PayoutBill; period: string; onRefused: (k: string | null) => void }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const client = useQueryClient();
  const { role } = useFinanceRole();
  const readOnly = readOnlyReason(role);
  const holds = useQuery({ queryKey: keys.holds(bill.id), queryFn: () => risk.holds(bill.id), retry: false });
  const [verdict, setVerdict] = useState<ClearVerdict>('false_positive');
  const [reason, setReason] = useState('');

  const clear = useMutation({
    mutationFn: () => risk.clearHold(bill.id, { reason: reason.trim(), verdict }),
    onSuccess: () => {
      onRefused(null);
      void client.invalidateQueries({ queryKey: keys.holds(bill.id) });
      void client.invalidateQueries({ queryKey: keys.batch(period) });
      void client.invalidateQueries({ queryKey: keys.preflight(period) });
    },
    onError: (err) => onRefused(refusalKey(err)),
  });

  const notOnServer = holds.error !== null && isNotOnServer(holds.error);
  const held = holds.data?.held === true;
  const inert =
    readOnly !== null ? t(readOnly) : notOnServer ? t('risk.holds.notOnServer') : !held ? t('risk.holds.none') : null;
  const longEnough = reason.trim().length >= 10;

  return (
    <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
      <div>
        <Section title={t('risk.evidence')}>
          {bill.risk.flags.length === 0 ? (
            <p className="text-[0.875rem] text-[var(--muted-foreground)]">{t('settle.preflight.anomalies.none')}</p>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {bill.risk.flags.map((f, i) => (
                <FlagCard key={`${f.signalId}-${i}`} flag={f} />
              ))}
            </div>
          )}
        </Section>
      </div>

      <div className="space-y-5">
        <Section title={t('risk.holds.title')}>
          {holds.isPending ? (
            <p className="text-[0.8125rem] text-[var(--muted-foreground)]">{t('bo.working')}</p>
          ) : notOnServer ? (
            <p className="text-[0.875rem] leading-relaxed text-[var(--muted-foreground)]">{t('risk.holds.notOnServer')}</p>
          ) : holds.error ? (
            <Problem title={t('settle.loadFailed')} body={t('settle.loadFailed.body')} />
          ) : holds.data === null || holds.data.history.length === 0 ? (
            <p className="text-[0.875rem] text-[var(--muted-foreground)]">{t('risk.holds.none')}</p>
          ) : (
            <ol className="space-y-2 text-[0.8125rem]">
              {holds.data.history.map((h) => (
                <li key={h.hold_id} className="rounded-[var(--radius-base)] bg-[var(--muted)] px-3 py-2">
                  <p>{t('risk.holds.raised', { at: when(h.raised_at, locale), signals: h.signal_ids.join(', ') || '—' })}</p>
                  {h.cleared_at ? (
                    <p className="mt-1 text-[var(--muted-foreground)]">
                      {t('risk.holds.cleared', {
                        at: when(h.cleared_at, locale),
                        who: h.cleared_by ?? '—',
                        verdict: h.clear_verdict ? t(`risk.verdict.${h.clear_verdict}`) : '—',
                        reason: h.clear_reason ?? '—',
                      })}
                    </p>
                  ) : (
                    <p className="mt-1 font-semibold">{t('risk.holds.open', { at: when(h.raised_at, locale) })}</p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title={t('risk.clear.title')}>
          {clear.isSuccess ? (
            <p className="text-[0.9375rem] font-semibold" role="status">
              {t('risk.clear.done')}
            </p>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                if (inert === null && longEnough && !clear.isPending) clear.mutate();
              }}
            >
              <Select
                label={t('risk.clear.verdict')}
                name="verdict"
                value={verdict}
                disabled={inert !== null}
                onChange={(e) => setVerdict(e.target.value as ClearVerdict)}
                options={VERDICTS.map((v) => ({ value: v, label: t(`risk.verdict.${v}`) }))}
              />
              <Field
                label={t('risk.clear.reason')}
                name="reason"
                value={reason}
                disabled={inert !== null}
                onChange={(e) => setReason(e.target.value)}
                hint={t('risk.clear.reason.hint')}
                minLength={10}
                required
              />
              <div>
                <Button type="submit" variant="primary" size="sm" disabled={inert !== null || !longEnough || clear.isPending} aria-describedby={`clear-reason-${bill.id}`}>
                  {clear.isPending ? t('bo.working') : t('risk.clear.submit')}
                </Button>
                <Reason id={`clear-reason-${bill.id}`}>{inert ?? t('risk.clear.reason.hint')}</Reason>
              </div>
            </form>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled aria-describedby={`actions-reason-${bill.id}`}>
              {t('risk.actions.escalate')}
            </Button>
            <Button size="sm" variant="outline" disabled aria-describedby={`actions-reason-${bill.id}`}>
              {t('risk.actions.hold')}
            </Button>
          </div>
          <Reason id={`actions-reason-${bill.id}`}>{t('risk.actions.unavailable')}</Reason>
        </Section>
      </div>
    </div>
  );
}
