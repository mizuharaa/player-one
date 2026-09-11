/** THESIS: a working ledger with one stable reading edge.
 * OWN-WORLD: Archivo, lavender navigation, paper surfaces, ink actions.
 * STORY: see measured work, open the right queue, inspect recent decisions.
 * FIRST VIEWPORT: a lavender hero band with the heading and Truc, four toned
 * evidence tiles, two operational rows with icon tiles.
 * FORM: the owner's 2026-09-10 request — light visual effects, contrast, punched
 * type, illustration — on top of the pinned workspace direction.
 * Every number remains API evidence; no sample metrics or stock media. The only
 * illustration is the existing Truc mark. */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Problem, Skeleton, VerdictPill } from '../components/ui/primitives.tsx';
import { IconArrow, IconBackOffice, IconReview, IconAlert } from '../components/icons.tsx';
import { Panda } from '../components/identity/Panda.tsx';
import { api, backOffice, ApiError } from '../lib/api.ts';
import { durationShort, money, pace, stampLocal } from '../lib/format.ts';
import { defaultPeriod } from '../payout/period.ts';

export function HomeScreen() {
  const { t, i18n } = useTranslation();
  const shift = useQuery({ queryKey: ['shift'], queryFn: () => api.shift(), refetchInterval: 60_000 });
  const recent = useQuery({ queryKey: ['recent'], queryFn: () => api.recent() });
  const tasks = useQuery({ queryKey: ['bo', 'tasks'], queryFn: () => backOffice.tasks() });
  const data = shift.data;
  const approval = data && data.decided > 0 ? `${Math.round(data.approved / data.decided * 100)}%` : '—';
  const refreshed = shift.dataUpdatedAt ? new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit' }).format(shift.dataUpdatedAt) : null;
  const refreshing = shift.isFetching || recent.isFetching || tasks.isFetching;
  const refresh = () => { void shift.refetch(); void recent.refetch(); void tasks.refetch(); };
  const reviews = recent.data?.reviews;
  const taskRows = tasks.data?.tasks.slice(0, 6);

  return <AppShell operator={data?.reviewer}>
    <div className="workspace-page workspace-home">
      <header className="workspace-page-header">
        <div className="workspace-home-hero-copy"><h1>{t('workspace.overview')}</h1><p>{t('workspace.overviewNote')}</p></div>
        <span className="workspace-home-mascot" aria-hidden="true"><Panda size={92} state="dayShift" /></span>
        <div className="workspace-actions">
          <button type="button" className="workspace-button" disabled={refreshing} onClick={refresh}>{t(refreshing ? 'workspace.refreshing' : 'workspace.refresh')}</button>
          <Link to="/counter" className="workspace-button workspace-button-primary">{t('workspace.handover')}<IconArrow size={15} /></Link>
        </div>
      </header>

      <section className="workspace-section" aria-labelledby="shift-title" data-guide="home.figures">
        <div className="workspace-section-heading"><div><h2 id="shift-title">{t('workspace.shift')}</h2><p>{t('workspace.shiftScope')}</p></div>
          {refreshed ? <span className="workspace-freshness">{t('workspace.updated', { time: refreshed })}</span> : null}
        </div>
        {shift.isError ? <QueryFailure error={shift.error} cached={!!data} retry={() => void shift.refetch()} busy={shift.isFetching} /> : null}
        <dl className="workspace-metrics">
          <Metric tone="ink" label={t('workspace.reviewed')} value={data ? String(data.decided) : null} loading={shift.isPending}
            note={data ? t('workspace.target', { count: data.target }) : undefined} />
          <Metric tone="lime" label={t('home.payable')} value={data ? durationShort(data.payable_seconds) : null} loading={shift.isPending} note={t('ui.a.home.payable.note')} />
          <Metric tone="lavender" label={t('workspace.approval')} value={data ? approval : null} loading={shift.isPending}
            note={data ? t('workspace.approvalNote', { approved: data.approved, decided: data.decided }) : undefined} />
          <Metric tone="paper" label={t('home.settled')} value={data ? money(data.settled_amount, data.currency) : null} loading={shift.isPending} note={t('ui.a.home.settled.note')} />
        </dl>
        <div className="workspace-summary-footer">
          <p>{t('ui.a.home.median')}: <strong className="num">{data?.median_seconds_to_verdict == null ? '—' : pace(Number(data.median_seconds_to_verdict))}</strong>
            <span className="workspace-inline-separator" aria-hidden="true">·</span>{t('queue.average')}: <strong className="num">{pace(data?.session_average_seconds ?? null)}</strong></p>
          <Link to="/settle" search={{ period: defaultPeriod() }} className="workspace-text-link">{t('workspace.settlement')}<IconArrow size={14} /></Link>
        </div>
      </section>

      <section className="workspace-section" aria-labelledby="attention-title" data-guide="home.attention">
        <div className="workspace-section-heading"><div><h2 id="attention-title">{t('workspace.attention')}</h2><p>{t('workspace.attentionNote')}</p></div></div>
        <div className="workspace-work-rows">
          <div className="workspace-work-row" data-guide="home.next"><span className="workspace-home-icon" aria-hidden="true"><IconReview size={22} /></span>
            <div><h3>{t('workspace.reviewQueue')}</h3><p>{t('workspace.reviewNote')}</p></div>
            <strong className="workspace-row-count num">{data?.queue_depth ?? '—'}</strong>
            <Link to="/review" className="workspace-button">{t('workspace.reviewAction')}<IconArrow size={14} /></Link>
          </div>
          <div className="workspace-work-row"><span className="workspace-home-icon" data-tone="warn" aria-hidden="true"><IconAlert size={22} /></span>
            <div><h3>{t('workspace.unresolved')}</h3><p>{t('workspace.unresolvedNote')}</p></div>
            <strong className="workspace-row-count num">{data?.needs_human ?? '—'}</strong>
            <Link to="/episodes" className="workspace-button">{t('workspace.resolveAction')}<IconArrow size={14} /></Link>
          </div>
        </div>
        {shift.isError && data ? <p className="workspace-inline-notice">{t('workspace.refreshFailed')}</p> : null}
      </section>

      <section className="workspace-section" aria-labelledby="recent-title" data-guide="home.recent">
        <div className="workspace-section-heading"><div><h2 id="recent-title">{t('recent.title')}</h2><p>{t('workspace.recentNote')}</p></div></div>
        {recent.isError ? <QueryFailure error={recent.error} cached={!!recent.data} retry={() => void recent.refetch()} busy={recent.isFetching} /> : null}
        {recent.isPending ? <RowsLoading /> : reviews?.length ? <div className="workspace-table-scroll" role="region" aria-labelledby="recent-title" tabIndex={0}>
          <table className="workspace-table"><thead><tr>
            {['time', 'episode', 'verdict', 'duration', 'amount', 'pace'].map((key) => <th key={key} scope="col">{t(`ui.a.home.recent.${key}`)}</th>)}
          </tr></thead><tbody>{reviews.map((review) => {
            const verdict = review.reviewState === 'pass' ? 'good' : review.reviewState === 'partial_pass' ? 'partial' : 'bad';
            return <tr key={review.reviewId}>
              <td className="num">{review.reviewedAt ? stampLocal(review.reviewedAt) : '—'}</td>
              <td className="num" title={review.episodeId}>{review.episodeId.slice(0, 8)}</td>
              <td><VerdictPill verdict={verdict} size="sm">{t(`verdict.${verdict}`)}</VerdictPill></td>
              <td className="num">{durationShort(review.measured)} <span aria-hidden="true">→</span> <strong>{durationShort(review.effective)}</strong></td>
              <td className="num">{money(review.amount, recent.data!.currency)}</td>
              <td className="num">{review.seconds === null ? '—' : pace(review.seconds)}</td>
            </tr>;
          })}</tbody></table>
        </div> : !recent.isError ? <div className="workspace-empty workspace-home-empty"><span aria-hidden="true"><Panda size={64} state="goldenHour" /></span><p>{t('recent.empty')}</p></div> : null}
      </section>

      <section className="workspace-section" aria-labelledby="tasks-title">
        <div className="workspace-section-heading"><div><h2 id="tasks-title">{t('workspace.tasks')}</h2><p>{t('workspace.tasksNote')}</p></div>
          <Link to="/backoffice" className="workspace-text-link">{t('workspace.manageTasks')}<IconArrow size={14} /></Link></div>
        {tasks.isError ? <QueryFailure error={tasks.error} cached={!!tasks.data} retry={() => void tasks.refetch()} busy={tasks.isFetching} /> : null}
        {tasks.isPending ? <RowsLoading /> : taskRows?.length ? <>
          <div className="workspace-table-scroll" role="region" aria-labelledby="tasks-title" tabIndex={0}><table className="workspace-table workspace-task-table">
            <thead><tr><th scope="col">{t('workspace.task')}</th><th scope="col">{t('workspace.state')}</th><th scope="col">{t('workspace.claimants')}</th></tr></thead>
            <tbody>{taskRows.map((task) => <tr key={task.id}><td><div className="workspace-task-name"><IconBackOffice size={20} /><div><strong>{task.name}</strong>{task.type ? <span>{task.type}</span> : null}</div></div></td>
              <td><span className="workspace-state">{t(`bo.task.state.${task.status}`)}</span></td><td className="num">{task.claimants} / {task.max_concurrent_claimants}</td></tr>)}</tbody>
          </table></div><p className="workspace-table-note">{t('workspace.taskSubset', { shown: taskRows.length, total: tasks.data!.tasks.length })}</p>
        </> : !tasks.isError ? <div className="workspace-empty workspace-home-empty"><span aria-hidden="true"><Panda size={64} state="earlyBird" /></span><div><h3>{t('workspace.taskEmpty')}</h3><p>{t('workspace.taskEmptyNote')}</p></div></div> : null}
      </section>
    </div>
  </AppShell>;
}

function Metric({ label, value, note, loading, tone }: { label: string; value: string | null; note?: string; loading: boolean; tone?: 'ink' | 'lime' | 'lavender' | 'paper' }) {
  const { t } = useTranslation();
  return <div className="workspace-metric" data-tone={tone}><dt>{label}</dt><dd>{loading ? <Skeleton className="h-8 w-20" /> : <span className="num">{value ?? '—'}</span>}
    <span className="workspace-metric-note">{!loading && value === null ? t('workspace.unavailable') : note}</span></dd></div>;
}

export function QueryFailure({ error, cached, retry, busy }: { error: unknown; cached: boolean; retry: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return <div className="workspace-query-error" role="status"><Problem title={t('workspace.loadFailed')}
    body={t(cached ? 'workspace.refreshFailed' : 'workspace.loadFailedNote')} reference={error instanceof ApiError ? error.ref : undefined} />
    <button className="workspace-button" type="button" disabled={busy} onClick={retry}>{t(busy ? 'workspace.refreshing' : 'workspace.retry')}</button></div>;
}

function RowsLoading() {
  const { t } = useTranslation();
  return <div className="workspace-rows-loading" aria-label={t('workspace.loading')} aria-busy="true">{[0, 1, 2].map((row) => <Skeleton key={row} className="h-10 w-full" />)}</div>;
}
