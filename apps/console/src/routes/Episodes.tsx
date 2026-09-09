/**
 * Episodes needing attention.
 *
 * This is **not** BO-05. BO-05 asks for every episode, browsable by task,
 * collector, device, status and recording time, and there is no endpoint that
 * returns that list — so the screen does not pretend to be it, and says so on
 * screen in one sentence rather than shipping four filter controls that
 * quietly search two hundred rows out of forty thousand.
 *
 * What it is instead is the honest intersection of what the counter lane can
 * answer today, and the whole design problem is that **the two answers are in
 * different scopes**:
 *
 * - **Blocking, this batch** — `GET /upload-batches/:id/exceptions`. Scoped to
 *   this *machine*, through `actor.machine.uploadDeviceId`, and to one batch.
 *   These are the episodes that hold that batch open. A parked episode is not
 *   among them (0018: parking IS the operator's answer) but is still counted
 *   in the summary, because a card whose episodes were all parked is not a
 *   clean card.
 * - **Stuck, this centre** — `GET /episodes/stuck`. Scoped to the whole
 *   *upload centre*, through `actor.operator.uploadCentreId`, with no window
 *   at all. Parked or held work, whichever batch it arrived on.
 *
 * Two lists that look alike and count different populations is how somebody
 * concludes a centre is clean because one machine's batch is. So each section
 * carries its scope as a sentence, not as a tooltip.
 *
 * The batch picker names its own window for the same reason: the list is the
 * server's default of 100, ordered by **import** time, which is when the card
 * reached the counter and not when the footage was recorded. An operator
 * looking for last Tuesday's recording will not find it by that clock, and the
 * label is where they find that out.
 *
 * Nothing here is inferred from the candidate sessions a batch carries. The
 * sessions appear in one place only — the picker inside the attribution
 * dialog, where the server itself requires the session to belong to the
 * delivery — and never as an attribute of an episode.
 */
import { lazy, Suspense, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
} from '@tanstack/react-table';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button } from '../components/ui/button.tsx';
import { Panel, Problem, Skeleton } from '../components/ui/primitives.tsx';
import { Panda } from '../components/identity/Panda.tsx';
import { IconAlert, IconArrow, IconRefresh } from '../components/icons.tsx';
import { cn } from '../lib/cn.ts';
import { refusalKey } from '../payout/refusals.ts';
import {
  ApiError,
  episodes as episodesApi,
  type BatchExceptions,
  type StuckEpisode,
} from '../lib/api.ts';

const PandaStage = lazy(() =>
  import('../components/identity/PandaStage.tsx').then((m) => ({ default: m.PandaStage })),
);

/**
 * `refusalKey` with one correction.
 *
 * The shared function is the payout console's, and its 404 sentence names a
 * bill. Everything else it decides is right here — a 409 naming a constraint
 * becomes that constraint's sentence, an unnamed one becomes the generic
 * refusal — so this replaces the one line that would be untrue rather than
 * forking the function.
 */
export const episodeRefusal = (error: unknown): string =>
  error instanceof ApiError && error.status === 404 ? 'episodes.gone' : refusalKey(error);

/** A UTC instant as the counter reads it. Never a duration, never money. */
function moment(iso: string | null): string {
  if (iso === null) return '—';
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? '—' : at.toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * `episodes.session_started_at` is NOT an instant, and reading it as one is
 * how this column came out as a row of dashes.
 *
 * The column is text, `YYYYMMDD_HHMMSS`, parsed from the recording directory's
 * own basename (schema.ts:109) — a wall clock the camera wrote, with no zone
 * on it. `new Date()` cannot parse that string, so `moment()` answered `—` for
 * every row. It is punctuated for reading and nothing else; a value that does
 * not match is printed as it came, because a stamp this screen cannot read is
 * still evidence and must not be hidden behind a dash.
 */
export function stamp(basename: string | null): string {
  if (basename === null) return '—';
  const m = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(basename);
  return m === null ? basename : `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}`;
}

/** The last twelve characters of an id: enough to tell two rows apart. */
const shortId = (id: string) => (id.length > 14 ? `…${id.slice(-12)}` : id);

/**
 * The value the hold filter matches on.
 *
 * An episode can be parked AND held — parked after a reviewer had already
 * taken it — and the two chips are `includesString`, so concatenating both
 * names is what keeps that row visible under either filter instead of it
 * disappearing from the one list that was supposed to surface it.
 */
export const holdKey = (r: Pick<StuckEpisode, 'park' | 'held'>): string =>
  `${r.park ? 'parked' : ''}${r.held ? 'held' : ''}`;

export function EpisodesScreen() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [outcomeFor, setOutcomeFor] = useState<string | null>(null);
  const [resolveFor, setResolveFor] = useState<string | null>(null);

  const batches = useQuery({ queryKey: ['batches'], queryFn: () => episodesApi.batches() });
  const rows = batches.data?.batches ?? [];
  /** The newest batch, until an operator picks another. The list is newest first. */
  const chosen = batchId ?? rows[0]?.id ?? null;

  const exceptions = useQuery({
    queryKey: ['batch-exceptions', chosen],
    queryFn: () => episodesApi.exceptions(chosen as string),
    enabled: chosen !== null,
  });

  const stuck = useQuery({ queryKey: ['episodes-stuck'], queryFn: () => episodesApi.stuck() });

  return (
    <AppShell>
      <header className="flex flex-wrap items-start gap-x-8 gap-y-4">
        <div className="min-w-0 flex-1">
          <h1 className="headline">
            {t('episodes.title')}
          </h1>
          {/*
            The one sentence that says what this screen is not. It is a
            paragraph on the page and not a footnote, because an operator who
            cannot find an episode here has to know within seconds whether they
            are searching wrongly or searching for something the server cannot
            answer.
          */}
          <p
            data-guide="episodes.scope"
            className="mt-4 max-w-[68ch] text-[1.0625rem] leading-relaxed text-[var(--muted-foreground)]"
          >
            {t('episodes.intro')}
          </p>
        </div>
        <div className="hidden shrink-0 sm:block">
          <Suspense fallback={<Panda size={104} />}>
            <PandaStage size={104} />
          </Suspense>
        </div>
      </header>

      {/* --- The window this screen loaded, and the batch inside it. --- */}
      <Panel className="mt-8 px-5 py-4">
        {batches.isPending ? (
          <Skeleton className="h-10 w-full max-w-[30rem]" />
        ) : batches.error ? (
          <Problem
            title={t('episodes.batch.failed')}
            body={t(episodeRefusal(batches.error))}
            reference={batches.error instanceof ApiError ? batches.error.ref : undefined}
          />
        ) : rows.length === 0 ? (
          <p className="text-[0.9375rem] text-[var(--muted-foreground)]">
            {t('episodes.batch.none')}
          </p>
        ) : (
          <div className="flex flex-wrap items-end gap-4">
            {/* `min-w-[17rem]` is the width one batch line needs: the import
                timestamp, the status and the tail of the id. Under that the
                option truncates mid-timestamp, so on a phone the button wraps
                to its own row rather than squeezing the select. */}
            <label className="flex min-w-[17rem] flex-1 flex-col gap-1.5">
              <span className="text-[0.8125rem] font-semibold text-[var(--muted-foreground)]">
                {t('episodes.batch.pick')}
              </span>
              <select
                value={chosen ?? ''}
                onChange={(e) => setBatchId(e.target.value)}
                className="num h-11 w-full max-w-[34rem] rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--card)] px-3 text-[0.875rem] text-[var(--foreground)] transition-colors duration-150 ease-[var(--ease)] hover:border-[var(--faint-foreground)]"
              >
                {rows.map((b) => (
                  <option key={b.id} value={b.id}>
                    {`${moment(b.importStartedAt)} · ${b.batchStatus} · ${shortId(b.id)}`}
                  </option>
                ))}
              </select>
            </label>
            <Button
              variant="outline"
              onClick={() => {
                void client.invalidateQueries({ queryKey: ['batches'] });
                void client.invalidateQueries({ queryKey: ['batch-exceptions'] });
                void client.invalidateQueries({ queryKey: ['episodes-stuck'] });
              }}
            >
              <IconRefresh size={17} />
              {t('episodes.reload')}
            </Button>
          </div>
        )}
        <p className="mt-3 text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">
          {t('episodes.batch')}
        </p>
      </Panel>

      {/* --- Section one: machine-scoped, one batch. --- */}
      <Scope
        title={t('episodes.blocking')}
        scope={t('episodes.blocking.scope')}
        summary={exceptions.data?.summary}
      >
        {chosen === null ? null : exceptions.isPending ? (
          <TableSkeleton />
        ) : exceptions.error ? (
          <Problem
            title={t('bo.refused')}
            body={t(episodeRefusal(exceptions.error))}
            reference={exceptions.error instanceof ApiError ? exceptions.error.ref : undefined}
          />
        ) : (
          <BlockingTable
            rows={exceptions.data?.blocking ?? []}
            onOutcome={setOutcomeFor}
            onResolve={setResolveFor}
          />
        )}
      </Scope>

      {/* --- Section two: centre-scoped, every batch. --- */}
      <Scope title={t('episodes.stuck')} scope={t('episodes.stuck.scope')}>
        {stuck.isPending ? (
          <TableSkeleton />
        ) : stuck.error ? (
          <Problem
            title={t('bo.refused')}
            body={t(episodeRefusal(stuck.error))}
            reference={stuck.error instanceof ApiError ? stuck.error.ref : undefined}
          />
        ) : (
          <StuckTable rows={stuck.data?.episodes ?? []} onOutcome={setOutcomeFor} />
        )}
      </Scope>

      {outcomeFor === null ? null : (
        <OutcomeDrawer episodeId={outcomeFor} onClose={() => setOutcomeFor(null)} />
      )}
      {resolveFor === null || !exceptions.data ? null : (
        <ResolveDialog
          episodeId={resolveFor}
          sessions={exceptions.data.sessions}
          onClose={() => setResolveFor(null)}
          onDone={() => {
            setResolveFor(null);
            void client.invalidateQueries({ queryKey: ['batch-exceptions'] });
            void client.invalidateQueries({ queryKey: ['episodes-stuck'] });
          }}
        />
      )}
    </AppShell>
  );
}

/**
 * One scope, with its sentence and — where the payload carries one — the
 * summary the server computed for it.
 *
 * The summary is not a row of stat cards: it is a single line of counts under
 * the scope sentence, so it reads as a description of the list below rather
 * than as four figures of its own. `episodes_per_session` is in it because the
 * server put it there for exactly this reason — seven episodes against one
 * declared session is not an error, and an operator should meet it here rather
 * than in a settlement report.
 */
function Scope({
  title,
  scope,
  summary,
  children,
}: {
  title: string;
  scope: string;
  summary?: BatchExceptions['summary'];
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <section className="mt-10">
      <h2 className="text-[1.3125rem] font-bold tracking-[-0.02em]">{title}</h2>
      <p className="mt-1.5 max-w-[72ch] text-[0.875rem] leading-relaxed text-[var(--muted-foreground)]">
        {scope}
      </p>

      {summary ? (
        <dl className="mt-3 flex flex-wrap items-baseline gap-x-6 gap-y-1.5">
          <Tally label={t('episodes.summary.episodes')} value={summary.episodes} />
          <Tally label={t('episodes.summary.sessions')} value={summary.sessions} />
          <Tally label={t('episodes.summary.quarantined')} value={summary.quarantined} />
          <Tally label={t('episodes.summary.awaiting')} value={summary.awaiting_confirmation} />
          <Tally label={t('episodes.summary.parked')} value={summary.parked} />
          <Tally
            label={t('episodes.summary.perSession')}
            value={summary.episodes_per_session ?? '—'}
          />
        </dl>
      ) : null}

      <div className="mt-4">{children}</div>
    </section>
  );
}

function Tally({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="text-[0.8125rem] text-[var(--muted-foreground)]">{label}</dt>
      <dd className="num m-0 text-[0.9375rem] font-semibold">{value}</dd>
    </div>
  );
}

/**
 * The empty state.
 *
 * Both scopes reach this on a clean centre, and on this console that has to be
 * distinguishable from a query that returned nothing because it was wrong: an
 * empty attention list means somebody IS being paid, an empty broken one means
 * somebody is not. So it is a drawn ground rather than a blank one, and the
 * sentence names the scope.
 *
 * No mascot in here, deliberately. Both scopes are empty on a clean centre and
 * both reach this state at once, so drawing Trúc inside it puts him on the
 * screen three times — twice here and once in the header — and a character
 * repeated down a page stops being a character. He stays in the header, where
 * he is on the screen whether the tables are empty or full.
 */
function NoRows() {
  const { t } = useTranslation();
  return (
    /*
     * The sentence sits on a card ground, not on the page ground.
     *
     * The hatch is drawn from `--border`, and on the dark scheme a hairline
     * pattern over `--background` left the sentence reading against a field
     * that is nearly the same value as the type: the detector measured 3.9:1
     * here, under the 4.5:1 body floor. Adding `--card` under it puts
     * `--muted-foreground` on the surface that token was measured against and
     * takes the pair to 6.70:1 in dark and 5.94:1 in light, with the hatch
     * still drawn on top so an empty scope still reads as a surface somebody
     * meant rather than as a render that failed.
     */
    <div className="hatch flex flex-col items-center rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] px-6 py-11 text-center">
      <p className="max-w-[72ch] text-[0.9375rem] text-[var(--muted-foreground)]">
        {t('episodes.empty')}
      </p>
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <Skeleton className="h-9 w-full" />
      <Skeleton className="h-9 w-5/6" />
      <Skeleton className="h-9 w-2/3" />
    </div>
  );
}

/* -------------------------------------------------------------------------
   The two tables.

   Both are TanStack Table with a client-side filter model, and the filters are
   on the columns the payload really carries — a text match on the episode id,
   and a chip row over the one enum each list has. Nothing filters by task,
   collector or recording time, because none of those three is in either
   response and a control that silently matches nothing is worse than no
   control.
   ---------------------------------------------------------------------- */

const blocking = createColumnHelper<BatchExceptions['blocking'][number]>();

function BlockingTable({
  rows,
  onOutcome,
  onResolve,
}: {
  rows: BatchExceptions['blocking'];
  onOutcome: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<ColumnFiltersState>([]);

  const columns = useMemo(
    () => [
      blocking.accessor('episode_id', {
        header: () => t('episodes.col.episode'),
        cell: (c) => <span className="num">{c.getValue()}</span>,
        filterFn: 'includesString',
      }),
      blocking.accessor('session_started_at', {
        header: () => t('episodes.col.session'),
        cell: (c) => <span className="num">{stamp(c.getValue())}</span>,
        enableColumnFilter: false,
      }),
      blocking.accessor('resolution_state', {
        header: () => t('episodes.col.state'),
        cell: (c) => <span className="num">{c.getValue()}</span>,
        enableColumnFilter: false,
      }),
      blocking.accessor('needs', {
        header: () => t('episodes.col.needs'),
        cell: (c) => (
          <span className="inline-flex items-center gap-1.5">
            <IconAlert size={15} className="shrink-0 text-[var(--warn)]" />
            {t(`episodes.needs.${c.getValue()}`)}
          </span>
        ),
        filterFn: 'equalsString',
      }),
    ],
    [t],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { columnFilters: filters },
    onColumnFiltersChange: setFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (rows.length === 0) return <NoRows />;

  return (
    <>
      <Filters>
        <TextFilter
          value={(table.getColumn('episode_id')?.getFilterValue() as string) ?? ''}
          onChange={(v) => table.getColumn('episode_id')?.setFilterValue(v)}
        />
        <Chips
          value={(table.getColumn('needs')?.getFilterValue() as string) ?? ''}
          onChange={(v) => table.getColumn('needs')?.setFilterValue(v === '' ? undefined : v)}
          options={[
            { value: 'assignment', label: t('episodes.needs.assignment') },
            { value: 'confirmation', label: t('episodes.needs.confirmation') },
          ]}
        />
      </Filters>

      <DataTable
        table={table}
        rowAction={(row) => (
          <span className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => onOutcome(row.episode_id)}>
              {t('episodes.outcome')}
            </Button>
            {row.needs === 'assignment' ? (
              <Button size="sm" variant="secondary" onClick={() => onResolve(row.episode_id)}>
                {t('episodes.resolve')}
              </Button>
            ) : null}
          </span>
        )}
      />
    </>
  );
}

const stuckCol = createColumnHelper<StuckEpisode>();

function StuckTable({
  rows,
  onOutcome,
}: {
  rows: StuckEpisode[];
  onOutcome: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [filters, setFilters] = useState<ColumnFiltersState>([]);

  const columns = useMemo(
    () => [
      stuckCol.accessor('episode_id', {
        header: () => t('episodes.col.episode'),
        cell: (c) => <span className="num">{c.getValue()}</span>,
        filterFn: 'includesString',
      }),
      stuckCol.accessor('device_serial', {
        header: () => t('episodes.col.device'),
        cell: (c) => <span className="num">{c.getValue()}</span>,
        filterFn: 'includesString',
      }),
      stuckCol.accessor('session_started_at', {
        header: () => t('episodes.col.session'),
        cell: (c) => <span className="num">{stamp(c.getValue())}</span>,
        enableColumnFilter: false,
      }),
      /*
       * An episode can be parked AND held — parked after a reviewer had
       * already taken it — so the hold column names both when both are there.
       * The accessor returns the pair as one string so the chip filter has a
       * single value to match, and so a row that carries both is never hidden
       * by a filter on one of them.
       */
      stuckCol.accessor(holdKey, {
        id: 'hold',
        header: () => t('episodes.col.hold'),
        cell: (c) => {
          const r = c.row.original;
          return (
            <span className="flex flex-wrap gap-1.5">
              {r.park ? <Hold label={t('episodes.hold.parked')} at={r.park.parked_at} /> : null}
              {r.held ? <Hold label={t('episodes.hold.held')} at={r.held.held_at} /> : null}
            </span>
          );
        },
        filterFn: 'includesString',
      }),
    ],
    [t],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { columnFilters: filters },
    onColumnFiltersChange: setFilters,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  if (rows.length === 0) return <NoRows />;

  return (
    <>
      <Filters>
        <TextFilter
          value={(table.getColumn('episode_id')?.getFilterValue() as string) ?? ''}
          onChange={(v) => table.getColumn('episode_id')?.setFilterValue(v)}
        />
        <Chips
          value={(table.getColumn('hold')?.getFilterValue() as string) ?? ''}
          onChange={(v) => table.getColumn('hold')?.setFilterValue(v === '' ? undefined : v)}
          options={[
            { value: 'parked', label: t('episodes.hold.parked') },
            { value: 'held', label: t('episodes.hold.held') },
          ]}
        />
      </Filters>

      <DataTable
        table={table}
        rowAction={(row) => (
          <span className="flex justify-end">
            <Button size="sm" variant="outline" onClick={() => onOutcome(row.episode_id)}>
              {t('episodes.outcome')}
            </Button>
          </span>
        )}
      />
    </>
  );
}

/* ---------------------------- shared table parts ---------------------- */

function Filters({ children }: { children: React.ReactNode }) {
  return <div className="mb-3 flex flex-wrap items-center gap-3">{children}</div>;
}

function TextFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  return (
    <label className="flex min-w-[14rem] flex-1 items-center">
      <span className="sr-only">{t('episodes.filter')}</span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t('episodes.filter')}
        className="num h-9 w-full rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--card)] px-3 text-[0.8125rem] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] transition-colors duration-150 ease-[var(--ease)] hover:border-[var(--faint-foreground)]"
      />
    </label>
  );
}

/**
 * A one-of-n filter, as buttons rather than a `<select>`.
 *
 * Two or three options that are all worth seeing at once; a select would hide
 * the vocabulary behind a click. Pressed state is `aria-pressed`, not colour
 * alone.
 */
function Chips({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? '' : o.value)}
            className={cn(
              'rounded-full px-3 py-1.5 text-[0.8125rem] font-semibold',
              'transition-colors duration-150 ease-[var(--ease)]',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              on
                ? 'bg-[var(--foreground)] text-[var(--background)]'
                : 'border border-[var(--border-strong)] text-[var(--muted-foreground)] hover:border-[var(--foreground)] hover:text-[var(--foreground)]',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

function Hold({ label, at }: { label: string; at: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--muted)] px-2.5 py-1 text-[0.75rem] font-semibold">
      {label}
      <span className="num font-normal text-[var(--muted-foreground)]">{moment(at)}</span>
    </span>
  );
}

/**
 * The table body, shared by both scopes so the two lists are one vocabulary.
 *
 * `getIsFiltered` decides the "nothing matched" line: a filter that hides every
 * row must not read as "this scope is clean", which is what reusing the empty
 * state here would say.
 */
function DataTable<T extends { episode_id: string }>({
  table,
  rowAction,
}: {
  table: ReturnType<typeof useReactTable<T>>;
  rowAction: (row: T) => React.ReactNode;
}) {
  const { t } = useTranslation();
  const shown = table.getRowModel().rows;

  return (
    <Panel className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} className="border-b border-[var(--border)]">
                {group.headers.map((header) => (
                  <th
                    key={header.id}
                    className="px-4 py-2.5 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]"
                  >
                    {flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
                <th className="px-4 py-2.5" />
              </tr>
            ))}
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td
                  colSpan={table.getAllColumns().length + 1}
                  className="px-4 py-8 text-center text-[0.875rem] text-[var(--muted-foreground)]"
                >
                  {t('episodes.noMatch')}
                </td>
              </tr>
            ) : (
              shown.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-[0.8125rem]">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                  <td className="px-4 py-3">{rowAction(row.original)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------- overlays ----------------------------- */

/**
 * A modal `<dialog>`, so focus trapping, the backdrop and Escape come from the
 * platform rather than from three effects that each get one of them wrong.
 * `showModal` runs from a ref callback because the element has to exist first.
 */
function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement | null>(null);

  return (
    <dialog
      ref={(node) => {
        ref.current = node;
        if (node && !node.open) node.showModal();
      }}
      onClose={onClose}
      onCancel={onClose}
      className={cn(
        /* `m-auto` centres it. Tailwind's preflight zeroes every margin, which
           takes `dialog:modal`'s own `margin:auto` with it and pins the box to
           the top-left corner — the same line Review's shortcut sheet carries. */
        'm-auto w-[min(34rem,calc(100vw-2rem))] rounded-[var(--radius-lg)] border border-[var(--border)]',
        'bg-[var(--card)] p-0 text-[var(--foreground)] shadow-[var(--shadow-lg)]',
        'backdrop:bg-[var(--scrim)]',
      )}
    >
      <div className="flex items-start gap-4 border-b border-[var(--border)] px-5 py-4">
        <h2 className="min-w-0 flex-1 text-[1.0625rem] font-bold tracking-[-0.01em]">{title}</h2>
        <Button size="sm" variant="ghost" onClick={() => ref.current?.close()}>
          {t('episodes.close')}
        </Button>
      </div>
      <div className="px-5 py-5">{children}</div>
    </dialog>
  );
}

/**
 * What the review lane decided about this episode.
 *
 * The verdict shown is the one on the delivery that currently counts — the
 * server picks it by `latest_ingest_id`, because a redelivery is judged on its
 * own bytes. The reason codes carry all three labels; the reader gets their
 * own and the code stays beside it, because the code is what an operator reads
 * out to a reviewer.
 */
function OutcomeDrawer({ episodeId, onClose }: { episodeId: string; onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const { data, isPending, error } = useQuery({
    queryKey: ['episode-outcome', episodeId],
    queryFn: () => episodesApi.outcome(episodeId),
  });

  const label = (r: { label_en: string; label_zh: string; label_vi: string }) =>
    i18n.language === 'zh' ? r.label_zh : i18n.language === 'vi' ? r.label_vi : r.label_en;

  return (
    <Modal title={t('episodes.outcome')} onClose={onClose}>
      <p className="num text-[0.8125rem] text-[var(--muted-foreground)]">{episodeId}</p>

      {isPending ? (
        <div className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-5 w-1/2" />
        </div>
      ) : error ? (
        <div className="mt-4">
          <Problem
            title={t('episodes.outcome.failed')}
            body={t(episodeRefusal(error))}
            reference={error instanceof ApiError ? error.ref : undefined}
          />
        </div>
      ) : data === null || data === undefined || data.review_state === null ? (
        <p className="mt-4 text-[0.9375rem] text-[var(--muted-foreground)]">
          {t('episodes.outcome.pending')}
        </p>
      ) : (
        <dl className="m-0 mt-4 flex flex-col gap-3">
          {/* The review verdict, which is NOT the attribution state the table
              column of that name carries. Two different words, so two keys. */}
          <Line label={t('episodes.outcome.state')} value={data.review_state} mono />
          <Line label={t('episodes.outcome.collector')} value={data.collector_id ?? '—'} mono />
          <Line label={t('episodes.outcome.decided')} value={moment(data.reviewed_at)} mono />
          {data.reviewer_note ? (
            <Line label={t('episodes.outcome.note')} value={data.reviewer_note} />
          ) : null}
          {data.reasons.length > 0 ? (
            <div>
              <dt className="text-[0.8125rem] text-[var(--muted-foreground)]">
                {t('episodes.outcome.reasons')}
              </dt>
              <dd className="m-0 mt-1.5 flex flex-col gap-1.5">
                {data.reasons.map((r) => (
                  <span key={r.code} className="flex items-baseline gap-2">
                    <span className="num shrink-0 text-[0.75rem] font-semibold text-[var(--tech-ink)]">
                      {r.code}
                    </span>
                    <span className="text-[0.875rem]">{label(r)}</span>
                  </span>
                ))}
              </dd>
            </div>
          ) : null}
        </dl>
      )}
    </Modal>
  );
}

function Line({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
      <dt className="text-[0.8125rem] text-[var(--muted-foreground)]">{label}</dt>
      <dd className={cn('m-0 text-[0.875rem] font-medium', mono && 'num')}>{value}</dd>
    </div>
  );
}

/**
 * PLT-05's human resolution path.
 *
 * Two fields, both mandatory, and both mandatory at the server too: the
 * session must belong to this delivery (a 409 otherwise) and the database
 * refuses a resolution that carries no reason. Making them `required` here is
 * not validation the server is missing — it is the same rule said early, so
 * the operator finds out before the write rather than after it.
 *
 * The session list comes from this batch's own payload. Nothing about the
 * episode is inferred from it: an operator picks the session, the server
 * checks the pick, and what the machine had guessed is kept on the audit row
 * so a dispute can see the difference.
 */
function ResolveDialog({
  episodeId,
  sessions,
  onClose,
  onDone,
}: {
  episodeId: string;
  sessions: BatchExceptions['sessions'];
  onClose: () => void;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [session, setSession] = useState(sessions[0]?.id ?? '');
  const [reason, setReason] = useState('');

  const resolve = useMutation({
    mutationFn: () =>
      episodesApi.resolve(episodeId, { collection_session_id: session, reason }),
    onSuccess: onDone,
  });

  return (
    <Modal title={t('episodes.resolve.title')} onClose={onClose}>
      <p className="num text-[0.8125rem] text-[var(--muted-foreground)]">{episodeId}</p>

      <form
        className="mt-4 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          resolve.mutate();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] font-semibold text-[var(--muted-foreground)]">
            {t('episodes.resolve.session')}
          </span>
          <select
            required
            value={session}
            onChange={(e) => setSession(e.target.value)}
            className="num h-11 rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--card)] px-3 text-[0.875rem] text-[var(--foreground)]"
          >
            {sessions.map((s) => (
              <option key={s.id} value={s.id}>
                {`${moment(s.prepareTime)} · ${s.sessionOrigin} · ${shortId(s.id)}`}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] font-semibold text-[var(--muted-foreground)]">
            {t('episodes.resolve.reason')}
          </span>
          <textarea
            required
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 text-[0.875rem] text-[var(--foreground)] transition-colors duration-150 ease-[var(--ease)] hover:border-[var(--faint-foreground)]"
          />
          <span className="text-[0.75rem] text-[var(--muted-foreground)]">
            {t('episodes.resolve.reasonHint')}
          </span>
        </label>

        {resolve.error ? (
          <Problem
            title={t('bo.refused')}
            body={t(episodeRefusal(resolve.error))}
            reference={resolve.error instanceof ApiError ? resolve.error.ref : undefined}
          />
        ) : null}

        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {t('bo.cancel')}
          </Button>
          <Button type="submit" variant="primary" disabled={resolve.isPending}>
            {resolve.isPending ? '…' : t('episodes.resolve')}
            <IconArrow size={17} />
          </Button>
        </div>
      </form>
    </Modal>
  );
}
