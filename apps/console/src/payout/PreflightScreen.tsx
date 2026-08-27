/**
 * Preflight: the screen that must have rendered before any payment is
 * possible.
 *
 * It asks the server two things — the preflight (balance, totals, limits,
 * counts) and the batch (every bill with its risk summary) — and shows them
 * side by side. Every number is the server's. The shortfall is the server's.
 * The "required with margin" figure is the server's. The counts of bills by
 * band and by problem are the server's; the counts of payout accounts by
 * verification state are counts of rows on this screen, which is counting
 * and not money.
 *
 * The gate. The bill screen only unlocks its payment controls while this
 * screen's snapshot for the period is in the cache, younger than the window,
 * and describing the batch as it still reads — `gate.ts` decides, and it is
 * a pure function with the boundary under test. It is a session-local gate,
 * not a server one — the server decides whether a payment may exist — but it
 * is the gate the brief asks for: nobody reaches "pay" without having had
 * the balance, the holds and the anomaly list in front of them, recently.
 *
 * In API mode the batch is sent from here as ONE server-side run (Agent B's
 * `runBatch`: preflight at entry, sequential, paced, stop on first refusal).
 * The console asks once and renders the report; it never iterates `/pay`.
 * The count and the total in the confirmation are the preflight's, and the
 * total is retyped rather than clicked.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button.tsx';
import { Panel, Problem } from '../components/ui/primitives.tsx';
import { payout, type BatchRun, type PayoutBill, type RiskBand } from '../lib/api.ts';
import { RiskBlock } from '../risk/pieces.tsx';
import { count, vnd, when } from './format.ts';
import { batchFingerprint, gateReasonKey, preflightGate, PREFLIGHT_WINDOW_MS, type GateState, type PreflightSnapshot } from './gate.ts';
import { keys } from './period.ts';
import { BandPill, Field, Fig, LoadFailed, Reason, Section, SettleShell, TableSkeleton } from './pieces.tsx';
import { isNotOnServer, refusalKey } from './refusals.ts';
import { readOnlyReason, useFinanceRole } from './role.ts';

const BANDS: RiskBand[] = ['clear', 'notice', 'review', 'hold'];

/**
 * The preflight query, shared with the bill screen's gate. The snapshot
 * carries the fingerprint of the batch as it read at the same moment, so the
 * gate can tell a batch that changed underneath it.
 */
export function usePreflight(period: string, enabled = true) {
  return useQuery({
    queryKey: keys.preflight(period),
    queryFn: async (): Promise<PreflightSnapshot | null> => {
      const [pre, batch] = await Promise.all([payout.preflight(period), payout.batch(period)]);
      if (pre === null) return null;
      return { ...pre, fingerprint: batchFingerprint(batch?.bills ?? []) };
    },
    enabled,
    /**
     * Valid for the window, and gone from the cache at the window: a snapshot
     * older than five minutes is not authorisation material and is not kept
     * around to look like some.
     */
    staleTime: PREFLIGHT_WINDOW_MS,
    gcTime: PREFLIGHT_WINDOW_MS,
  });
}

/** A clock that ticks, so a gate closes while the operator is looking at it. */
export function useNow(everyMs = 10_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), everyMs);
    return () => window.clearInterval(id);
  }, [everyMs]);
  return now;
}

/** The gate for a period, from the cached snapshot and the batch as it reads now. */
export function useGate(period: string, bills: readonly PayoutBill[] | undefined): { gate: GateState; snapshot: PreflightSnapshot | null | undefined; fetchedAt: number } {
  const pre = usePreflight(period, false);
  const now = useNow();
  const gate = preflightGate({
    snapshot: pre.data,
    fetchedAt: pre.dataUpdatedAt,
    batchFingerprint: batchFingerprint(bills ?? []),
    now,
  });
  return { gate, snapshot: pre.data, fetchedAt: pre.dataUpdatedAt };
}

export function PreflightScreen() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const { period } = useSearch({ strict: false }) as { period: string };
  const pre = usePreflight(period);
  const batch = useQuery({ queryKey: keys.batch(period), queryFn: () => payout.batch(period) });
  const mode = batch.data?.mode ?? pre.data?.mode;

  if (pre.error || batch.error) {
    return (
      <SettleShell period={period} tab="preflight" mode={mode}>
        <LoadFailed />
      </SettleShell>
    );
  }
  if (pre.isPending || batch.isPending || pre.data === null || batch.data === null) {
    return (
      <SettleShell period={period} tab="preflight" mode={mode}>
        <TableSkeleton />
      </SettleShell>
    );
  }

  const p = pre.data;
  const bills = batch.data.bills;
  const accounts = {
    verified: bills.filter((b) => b.account?.verify_status === 'verified').length,
    mismatch: bills.filter((b) => b.account?.verify_status === 'name_mismatch').length,
    unverified: bills.filter((b) => b.account !== null && b.account.verify_status !== 'verified' && b.account.verify_status !== 'name_mismatch').length,
    missing: bills.filter((b) => b.account === null).length,
  };
  const ranked = [...bills].sort((a, b) => b.risk.score - a.risk.score).slice(0, 20);
  const flagged = ranked.filter((b) => b.risk.flags.length > 0);
  const others = (['attempt_open', 'already_paid', 'total_fractional', 'no_account', 'account_unverified', 'under_bank_minimum', 'risk_hold'] as const).filter(
    (k) => p.counts[k] > 0,
  );

  return (
    <SettleShell period={period} tab="preflight" mode={mode}>
      <p className="mb-4 max-w-[62ch] text-[0.9375rem] leading-relaxed text-[var(--muted-foreground)]">{t('settle.preflight.intro')}</p>

      {/* --- The one hero: can the batch be sent. --- */}
      <Panel className="p-5 sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Fig
            label={t('settle.preflight.balance')}
            value={p.balance_vnd === null ? '—' : vnd(p.balance_vnd, locale)}
            hint={p.balance_vnd === null ? t('settle.preflight.balance.none') : undefined}
          />
          <Fig label={t('settle.preflight.total')} value={vnd(p.total_vnd, locale)} tone="data" />
          <Fig label={t('settle.preflight.required')} value={vnd(p.required_vnd, locale)} hint={t('settle.preflight.required.hint')} />
          <Fig
            label={t('settle.preflight.shortfall')}
            value={vnd(p.shortfall_vnd, locale)}
            tone={p.shortfall_vnd > 0 ? 'warn' : 'default'}
          />
        </div>
        <div className="mt-5 border-t border-[var(--border)] pt-4">
          {p.ok ? (
            <p className="text-[0.9375rem] font-semibold" role="status">
              {t('settle.preflight.ok', { payable: count(p.payable, locale), bills: count(p.bills, locale) })}
            </p>
          ) : (
            <>
              <p className="text-[0.9375rem] font-semibold text-[var(--sun-700)]" role="status">
                {t('settle.preflight.refused')}
              </p>
              {p.refusal ? (
                <p className="mt-1 text-[0.8125rem] text-[var(--muted-foreground)]">
                  {t('settle.preflight.serverSaid')}: <span className="num text-[var(--foreground)]">{p.refusal}</span>
                </p>
              ) : null}
            </>
          )}
          <p className="mt-2 text-[0.75rem] text-[var(--faint-foreground)]">
            {t('settle.preflight.ranAt', { at: when(new Date(pre.dataUpdatedAt).toISOString(), locale) })} ·{' '}
            <button type="button" className="font-semibold text-[var(--tech-600)]" onClick={() => void pre.refetch()}>
              {t('settle.preflight.rerun')}
            </button>
          </p>
        </div>
      </Panel>

      {/* --- The counts. --- */}
      <div className="mt-6 grid gap-4 md:grid-cols-3">
        <Panel className="p-5">
          <Section title={t('settle.preflight.bands')}>
            <ul className="space-y-2">
              {BANDS.map((band) => (
                <li key={band} className="flex items-center justify-between gap-3">
                  <BandPill band={band} size="sm" />
                  <span className="num text-[1.0625rem] font-semibold">{count(p.risk_bands[band], locale)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </Panel>
        <Panel className="p-5">
          <Section title={t('settle.preflight.accounts')}>
            <ul className="space-y-2 text-[0.875rem]">
              {(
                [
                  ['verified', accounts.verified],
                  ['unverified', accounts.unverified],
                  ['mismatch', accounts.mismatch],
                  ['missing', accounts.missing],
                ] as const
              ).map(([k, n]) => (
                <li key={k} className="flex items-center justify-between gap-3">
                  <span>{t(`settle.preflight.accounts.${k}`)}</span>
                  <span className="num text-[1.0625rem] font-semibold">{count(n, locale)}</span>
                </li>
              ))}
            </ul>
          </Section>
        </Panel>
        <Panel className="p-5">
          <Section title={t('settle.preflight.limits')}>
            <ul className="space-y-2 text-[0.875rem]">
              <li className="flex items-center justify-between gap-3">
                <span>{t('settle.preflight.ceiling', { ceiling: vnd(p.bank_ceiling_vnd, locale) })}</span>
                <span className="num text-[1.0625rem] font-semibold">{count(p.counts.over_bank_ceiling, locale)}</span>
              </li>
              <li className="flex items-center justify-between gap-3">
                <span>{p.cap_vnd === null ? t('settle.preflight.cap.none') : t('settle.preflight.cap', { cap: vnd(p.cap_vnd, locale) })}</span>
                <span className="num text-[1.0625rem] font-semibold">{p.cap_vnd === null ? '—' : count(p.counts.over_cap, locale)}</span>
              </li>
            </ul>
            {others.length > 0 ? (
              <>
                <h3 className="mt-4 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]">{t('settle.preflight.others')}</h3>
                <ul className="mt-2 space-y-1.5 text-[0.8125rem]">
                  {others.map((k) => (
                    <li key={k} className="flex items-center justify-between gap-3">
                      <span>{t(`settle.issue.${k}`)}</span>
                      <span className="num font-semibold">{count(p.counts[k], locale)}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </Section>
        </Panel>
      </div>

      {/* --- The anomaly list. --- */}
      <Panel className="mt-6 p-5">
        <Section title={t('settle.preflight.anomalies')}>
          <p className="text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">
            {t('settle.preflight.anomalies.hint', { n: count(ranked.length, locale) })}
          </p>
          {flagged.length === 0 ? (
            <p className="mt-3 text-[0.875rem]">{t('settle.preflight.anomalies.none')}</p>
          ) : (
            <ol className="mt-3 divide-y divide-[var(--border)]">
              {flagged.map((b) => (
                <li key={b.id} className="py-3">
                  <p className="num mb-1 text-[0.875rem] font-semibold">
                    <Link to="/settle/bills/$billId" params={{ billId: b.id }} search={{ period }} className="text-[var(--tech-600)]">
                      {b.collector_ref}
                    </Link>
                  </p>
                  <RiskBlock summary={b.risk} period={period} billId={b.id} />
                </li>
              ))}
            </ol>
          )}
        </Section>
      </Panel>

      {/* --- What happens next. --- */}
      <div className="mt-6">
        {mode === 'api' ? (
          <ApiBatch snapshot={p} fetchedAt={pre.dataUpdatedAt} bills={bills} period={period} />
        ) : (
          <Panel className="p-5">
            <p className="text-[0.9375rem] leading-relaxed">{t('settle.preflight.continue.manual')}</p>
            <Button asChild variant="primary" className="mt-4">
              <Link to="/settle" search={{ period }}>
                {t('settle.tab.bills')}
              </Link>
            </Button>
          </Panel>
        )}
      </div>
    </SettleShell>
  );
}

/* -------------------------------------------------------------------------
   The API rail: "send N transfers totalling X", as one server-side run.
   The console asks once and renders the report. If the server has no run
   route, the answer is 404 and the screen says exactly that.
   ---------------------------------------------------------------------- */

function ApiBatch({ snapshot: p, fetchedAt, bills, period }: { snapshot: PreflightSnapshot; fetchedAt: number; bills: PayoutBill[]; period: string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const client = useQueryClient();
  const { role } = useFinanceRole();
  const readOnly = readOnlyReason(role);
  const now = useNow();
  const gate = preflightGate({ snapshot: p, fetchedAt, batchFingerprint: batchFingerprint(bills), now });
  const [typed, setTyped] = useState('');
  const [notOnServer, setNotOnServer] = useState(false);
  const [refusedKey, setRefusedKey] = useState<string | null>(null);

  const run = useMutation({
    mutationFn: () => payout.runBatch(period),
    onSuccess: () => {
      setRefusedKey(null);
      void client.invalidateQueries({ queryKey: keys.batch(period) });
      void client.invalidateQueries({ queryKey: keys.preflight(period) });
    },
    onError: (err) => {
      if (isNotOnServer(err)) setNotOnServer(true);
      else setRefusedKey(refusalKey(err));
    },
  });

  const collectorOf = (billId: string) => bills.find((b) => b.id === billId)?.collector_ref ?? billId;
  const matches = typed !== '' && typed === String(p.total_vnd);
  const gateKey = gateReasonKey(gate);
  const blocked =
    readOnly !== null
      ? t(readOnly)
      : gateKey !== null
        ? t(gateKey)
        : !p.ok || p.payable === 0
          ? t('settle.batch.noneOk')
          : notOnServer
            ? t('settle.batch.notOnServer')
            : null;
  const report: BatchRun | null | undefined = run.data;

  return (
    <Panel className="p-5">
      <Section title={t('settle.batch.title')}>
        <p className="text-[1.0625rem] font-semibold">
          {t('settle.batch.sentence', { n: count(p.payable, locale), total: vnd(p.total_vnd, locale) })}
        </p>
        <p className="mt-1 text-[0.8125rem] text-[var(--muted-foreground)]">{t('settle.batch.serverLoop')}</p>
        {blocked ? (
          <>
            <Button variant="primary" className="mt-4" disabled aria-describedby="batch-reason">
              {t('settle.batch.send', { n: count(p.payable, locale) })}
            </Button>
            <Reason id="batch-reason">{blocked}</Reason>
          </>
        ) : (
          <form
            className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,20rem)_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              if (matches && !run.isPending) run.mutate();
            }}
          >
            <Field
              label={t('settle.batch.retype')}
              name="total"
              inputMode="numeric"
              pattern="\d+"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value.replace(/\D/g, ''))}
              hint={typed !== '' && !matches ? t('settle.batch.mismatch') : `${p.total_vnd}`}
              aria-invalid={typed !== '' && !matches}
              required
            />
            <Button type="submit" variant="primary" disabled={!matches || run.isPending} aria-describedby="batch-reason">
              {run.isPending ? t('bo.working') : t('settle.batch.send', { n: count(p.payable, locale) })}
            </Button>
            <Reason id="batch-reason">{t('settle.batch.retype.hint')}</Reason>
          </form>
        )}

        {refusedKey ? (
          <div className="mt-4">
            <Problem title={t('bo.refused')} body={t(refusedKey)} />
          </div>
        ) : null}

        {report ? <RunReport report={report} collectorOf={collectorOf} /> : null}
      </Section>
    </Panel>
  );
}

/** The server's report of a run, as sentences. */
function RunReport({ report, collectorOf }: { report: BatchRun; collectorOf: (billId: string) => string }) {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  const refusedConstraint = (c: string) => {
    const key = `bo.refused.${c}`;
    return t(key) === key ? c : t(key);
  };
  return (
    <div className="mt-4" aria-live="polite">
      {!report.preflight.ok ? (
        <Problem
          title={t('settle.preflight.refused')}
          body={t('settle.batch.refusedAtSend', { reason: report.preflight.refusal ?? '—' })}
        />
      ) : null}
      {report.sent.length > 0 ? (
        <ol className="divide-y divide-[var(--border)] text-[0.875rem]">
          {report.sent.map((s) => (
            <li key={s.bill_id} className="flex items-center justify-between gap-3 py-1.5">
              <span className="num font-semibold">{collectorOf(s.bill_id)}</span>
              <span className="num text-[var(--muted-foreground)]">{t(`settle.attempt.${s.status}`)}</span>
            </li>
          ))}
        </ol>
      ) : null}
      {report.stopped_at !== null ? (
        <div className="mt-3">
          <Problem
            title={t('bo.refused')}
            body={t('settle.batch.stopped', {
              collector: collectorOf(report.stopped_at),
              reason: refusedConstraint(
                report.refused.find((r) => r.bill_id === report.stopped_at)?.constraint ?? 'payout_transfer_rejected',
              ),
            })}
          />
        </div>
      ) : report.preflight.ok ? (
        <p className="mt-3 text-[0.9375rem] font-semibold" role="status">
          {t('settle.batch.done', { n: count(report.sent.length, locale) })}
        </p>
      ) : null}
    </div>
  );
}
