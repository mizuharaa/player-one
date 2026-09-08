import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button } from '../components/ui/button.tsx';
import { EmptyState, Panel, Problem, Skeleton } from '../components/ui/primitives.tsx';
import { ApiError, backOffice, browseEpisodes, type BrowsedEpisode } from '../lib/api.ts';

const FILTERS = ['task_id', 'collector_id', 'device_id', 'status', 'from', 'to'] as const;
type Filter = (typeof FILTERS)[number];
type Search = Partial<Record<Filter, string>>;

export function episodeSearch(raw: Record<string, unknown>): Search {
  return Object.fromEntries(FILTERS.flatMap((key) =>
    typeof raw[key] === 'string' && raw[key] !== '' ? [[key, raw[key]]] : [],
  ));
}

const INPUT = 'mt-1 h-10 w-full rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--card)] px-3 text-sm';
const helper = createColumnHelper<BrowsedEpisode>();

export function EpisodesScreen() {
  const search = useSearch({ from: '/episodes' });
  const query = new URLSearchParams(search).toString();
  return <EpisodesBrowse key={query} search={search} query={query} />;
}

function EpisodesBrowse({ search, query }: { search: Search; query: string }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [draft, setDraft] = useState<Search>(search);
  const episodes = useQuery({ queryKey: ['episodes', search], queryFn: () => browseEpisodes(query) });
  const tasks = useQuery({ queryKey: ['bo', 'tasks'], queryFn: backOffice.tasks });
  const collectors = useQuery({ queryKey: ['bo', 'collectors'], queryFn: backOffice.collectors });
  const devices = useQuery({ queryKey: ['bo', 'devices'], queryFn: backOffice.devices });
  const options = {
    task_id: (tasks.data?.tasks ?? []).map((r) => ({ value: r.id, label: r.name })),
    collector_id: (collectors.data?.collectors ?? []).map((r) => ({ value: r.id, label: r.external_ref })),
    device_id: (devices.data?.devices ?? []).map((r) => ({ value: r.id, label: r.hardware_serial })),
    status: ['resolved', 'quarantined'].map((s) => ({ value: s, label: t(`episodes.${s}`) })),
  };
  const columns = useMemo(() => [
    helper.accessor('episode_id', { header: t('episodes.id'), cell: (c) => <span className="num">{c.getValue()}</span> }),
    helper.accessor('task_name', { header: t('episodes.task_id'), cell: (c) => c.getValue() ?? t('episodes.unattributed') }),
    helper.accessor('collector_ref', { header: t('episodes.collector_id'), cell: (c) => c.getValue() ?? t('episodes.unattributed') }),
    helper.accessor('device_serial', { header: t('episodes.device_id'), cell: (c) => <span className="num">{c.getValue() ?? t('episodes.unattributed')}</span> }),
    helper.accessor('resolution_state', { header: t('episodes.status'), cell: (c) => t(`episodes.${c.getValue()}`) }),
    helper.accessor('first_seen_at', { header: t('episodes.firstSeen'), cell: (c) => <time className="num" dateTime={c.getValue()}>{c.getValue()}</time> }),
    helper.accessor('session_started_at', { header: t('episodes.recorded'), cell: (c) => <span className="num">{c.getValue()}</span> }),
  ], [t]);
  const table = useReactTable({ data: episodes.data?.episodes ?? [], columns, getCoreRowModel: getCoreRowModel() });
  const error = episodes.error ?? tasks.error ?? collectors.error ?? devices.error;
  const change = (key: Filter, value: string) => setDraft((s) => ({ ...s, [key]: value }));

  return (
    <AppShell>
      <header>
        <h1 className="text-3xl font-extrabold tracking-tight">{t('nav.episodes')}</h1>
        <p className="mt-3 text-[var(--muted-foreground)]">{t('episodes.intro')}</p>
        <p className="mt-2 text-sm text-[var(--muted-foreground)]">{t('episodes.noBatch')}</p>
      </header>
      <form className="mt-6 grid grid-cols-1 items-end gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate({ to: '/episodes', search: episodeSearch(draft) });
        }}>
        {(['task_id', 'collector_id', 'device_id', 'status'] as const).map((key) => (
          <label key={key} className="min-w-0 text-sm font-semibold">
            {t(`episodes.${key}`)}
            <select name={key} className={INPUT} value={draft[key] ?? ''} onChange={(e) => change(key, e.target.value)}>
              <option value="">{t('episodes.all')}</option>
              {draft[key] && !options[key].some((o) => o.value === draft[key]) ? <option value={draft[key]}>{draft[key]}</option> : null}
              {options[key].map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        ))}
        {(['from', 'to'] as const).map((key) => (
          <label key={key} className="min-w-0 text-sm font-semibold">
            {t(`episodes.${key}`)}
            <input name={key} className={INPUT} value={draft[key] ?? ''}
              placeholder="2026-09-08T00:00:00+07:00" aria-describedby="episode-time-hint"
              onChange={(e) => change(key, e.target.value)} />
          </label>
        ))}
        <Button type="submit" variant="outline">{t('episodes.apply')}</Button>
        <p id="episode-time-hint" className="text-sm text-[var(--muted-foreground)] sm:col-span-2 lg:col-span-4">{t('episodes.timeHint')}</p>
      </form>
      <div className="mt-6" aria-live="polite" aria-busy={episodes.isFetching}>
        {error ? <Problem title={t('bo.loadFailed')}
          body={t(error instanceof ApiError && error.status === 400 ? 'episodes.invalid' : 'bo.loadFailed.body')}
          reference={error instanceof ApiError ? error.ref : undefined}
          action={<Button variant="outline" onClick={() => {
            void episodes.refetch(); void tasks.refetch(); void collectors.refetch(); void devices.refetch();
          }}>{t('episodes.retry')}</Button>} />
          : episodes.isPending ? <Skeleton className="h-20 w-full" />
          : table.getRowModel().rows.length === 0 ? <EmptyState title={t('episodes.empty')} body={t('episodes.emptyBody')} />
          : <Panel className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-sm">
                <thead>{table.getHeaderGroups().map((group) => <tr key={group.id} className="border-b border-[var(--border)]">
                  {group.headers.map((h) => <th key={h.id} scope="col" className="whitespace-nowrap px-4 py-3 font-semibold text-[var(--muted-foreground)]">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>)}
                </tr>)}</thead>
                <tbody>{table.getRowModel().rows.map((row) => <tr key={row.id} className="border-b border-[var(--border)] hover:bg-[var(--muted)]">
                  {row.getVisibleCells().map((cell) => <td key={cell.id} className="whitespace-nowrap px-4 py-3 align-top">
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>)}
                </tr>)}</tbody>
              </table>
            </div>
          </Panel>}
        {episodes.data?.truncated ? <p className="mt-3 text-sm text-[var(--muted-foreground)]">{t('episodes.truncated')}</p> : null}
      </div>
    </AppShell>
  );
}
