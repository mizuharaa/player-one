/**
 * Settle: the bills of a period (SET-07, BO-08), and the way into paying them.
 *
 * The table joins two server reads and computes nothing. The batch route
 * says which bills exist, what they total in stored decimal and in whole
 * dong, what the engine thinks of them and where their payout stands; the
 * per-collector income route says the valid minutes and the withheld and net
 * figures, which the batch route does not carry. Both are rendered as
 * received. Withheld is 0 and net equals gross on every row until the PIT
 * rate is decided, and the note under the table says so — a column of zeros
 * with no sentence beside it would read as a bug or, worse, as a decision.
 *
 * Sorting is comparison, not arithmetic; a money column sorts by comparing
 * `Number()` of two strings and never subtracts them.
 */
import { useMemo, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useSearch } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type SortingState,
} from '@tanstack/react-table';
import { Button } from '../components/ui/button.tsx';
import { EmptyState, Panel } from '../components/ui/primitives.tsx';
import { cn } from '../lib/cn.ts';
import { payout, settle, type IncomePeriod, type PayoutBill } from '../lib/api.ts';
import { BAND_ORDER } from '../risk/sentences.ts';
import { asStored, count, vnd } from './format.ts';
import { keys } from './period.ts';
import {
  AttemptPill,
  BandPill,
  LoadFailed,
  Reason,
  RefusedBanner,
  SettleShell,
  Table,
  TableSkeleton,
  Td,
  Th,
} from './pieces.tsx';
import { refusalKey } from './refusals.ts';
import { readOnlyReason, useFinanceRole } from './role.ts';

type Row = { bill: PayoutBill; income: IncomePeriod | null };

const helper = createColumnHelper<Row>();

/** Orders two decimal strings without subtracting them. */
const byNumber = (a: string | null | undefined, b: string | null | undefined): number => {
  const x = a === null || a === undefined ? Number.NEGATIVE_INFINITY : Number(a);
  const y = b === null || b === undefined ? Number.NEGATIVE_INFINITY : Number(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

export function SettleScreen() {
  const { t, i18n } = useTranslation();
  const { period } = useSearch({ strict: false }) as { period: string };
  const client = useQueryClient();
  const [refused, setRefused] = useState<string | null>(null);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'collector', desc: false }]);
  const { role } = useFinanceRole();
  const readOnly = readOnlyReason(role);

  const batch = useQuery({ queryKey: keys.batch(period), queryFn: () => payout.batch(period) });
  const bills = batch.data?.bills ?? [];
  const collectors = useMemo(() => [...new Set(bills.map((b) => b.collector_id))], [bills]);
  const incomes = useQueries({
    queries: collectors.map((id) => ({ queryKey: keys.income(id), queryFn: () => payout.income(id) })),
  });

  const rows = useMemo<Row[]>(() => {
    const byBill = new Map<string, IncomePeriod>();
    for (const q of incomes) for (const p of q.data?.periods ?? []) if (p.bill_id) byBill.set(p.bill_id, p);
    return bills.map((bill) => ({ bill, income: byBill.get(bill.id) ?? null }));
  }, [bills, incomes]);

  const generate = useMutation({
    mutationFn: () => settle.generate(period),
    onSuccess: () => {
      setRefused(null);
      void client.invalidateQueries({ queryKey: keys.batch(period) });
      void client.invalidateQueries({ queryKey: keys.preflight(period) });
      for (const id of collectors) void client.invalidateQueries({ queryKey: keys.income(id) });
    },
    onError: (err) => setRefused(refusalKey(err)),
  });

  const columns = useMemo(
    () => [
      helper.accessor((r) => r.bill.collector_ref, {
        id: 'collector',
        header: t('settle.col.collector'),
        cell: (c) => <span className="num font-semibold">{c.getValue()}</span>,
      }),
      helper.accessor((r) => r.income?.valid_minutes ?? null, {
        id: 'minutes',
        header: t('settle.col.minutes'),
        sortingFn: (a, b) => byNumber(a.getValue('minutes'), b.getValue('minutes')),
        cell: (c) => <span className="num">{asStored(c.getValue())}</span>,
      }),
      helper.accessor((r) => r.bill.total, {
        id: 'gross',
        header: t('settle.col.gross'),
        sortingFn: (a, b) => byNumber(a.getValue('gross'), b.getValue('gross')),
        cell: (c) => (
          <span className="num">
            {asStored(c.getValue())}
            <span className="ml-2 text-[var(--muted-foreground)]">{vnd(c.row.original.bill.amount_vnd, i18n.language)}</span>
          </span>
        ),
      }),
      helper.accessor((r) => r.income?.withheld ?? null, {
        id: 'withheld',
        header: t('settle.col.withheld'),
        sortingFn: (a, b) => byNumber(a.getValue('withheld'), b.getValue('withheld')),
        cell: (c) => <span className="num">{asStored(c.getValue())}</span>,
      }),
      helper.accessor((r) => r.income?.net ?? null, {
        id: 'net',
        header: t('settle.col.net'),
        sortingFn: (a, b) => byNumber(a.getValue('net'), b.getValue('net')),
        cell: (c) => <span className="num">{asStored(c.getValue())}</span>,
      }),
      helper.accessor((r) => r.bill.risk.band, {
        id: 'band',
        header: t('settle.col.band'),
        sortingFn: (a, b) => BAND_ORDER[a.original.bill.risk.band] - BAND_ORDER[b.original.bill.risk.band],
        cell: (c) => (
          <span className="inline-flex items-center gap-2">
            <BandPill band={c.getValue()} size="sm" />
            <span className="num text-[0.75rem] text-[var(--muted-foreground)]">{c.row.original.bill.risk.score}</span>
          </span>
        ),
      }),
      helper.accessor((r) => r.bill.attempt?.status ?? 'none', {
        id: 'attempt',
        header: t('settle.col.attempt'),
        cell: (c) => <AttemptPill status={c.row.original.bill.attempt?.status ?? null} />,
      }),
      helper.display({
        id: 'open',
        header: '',
        cell: (c) => (
          <Button asChild size="sm" variant="outline">
            <Link to="/settle/bills/$billId" params={{ billId: c.row.original.bill.id }} search={{ period }}>
              {t('settle.col.open')}
            </Link>
          </Button>
        ),
      }),
    ],
    [t, i18n.language, period],
  );

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  return (
    <SettleShell period={period} tab="bills" mode={batch.data?.mode}>
      <RefusedBanner refusedKey={refused} onDismiss={() => setRefused(null)} />

      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div>
          <Button variant="primary" disabled={generate.isPending} onClick={() => generate.mutate()}>
            {generate.isPending ? t('bo.working') : t('settle.generate')}
          </Button>
          <Reason id="generate-hint">{t('settle.generate.hint')}</Reason>
          {generate.data !== undefined && generate.data !== null ? (
            <div className="mt-1 max-w-[70ch] text-[0.8125rem] font-semibold leading-relaxed" role="status">
              <p>
                {t('settle.generate.result', {
                  created: generate.data.created,
                  notPayable: generate.data.not_payable,
                })}
              </p>
              {generate.data.deferred_to_next_period.settlements > 0 ? (
                <p>
                  {t('settle.generate.deferred', {
                    n: count(generate.data.deferred_to_next_period.settlements, i18n.language),
                    who: generate.data.deferred_to_next_period.collector_refs.join(', '),
                  })}
                </p>
              ) : null}
              {generate.data.skipped.settlements > 0 ? (
                <p>
                  {t('settle.generate.skipped', {
                    n: count(generate.data.skipped.settlements, i18n.language),
                    who: generate.data.skipped.collector_refs.join(', '),
                  })}
                </p>
              ) : null}
              {generate.data.exception > 0 ? (
                <p>{t('settle.generate.exception', { n: count(generate.data.exception, i18n.language) })}</p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="sm:ml-auto">
          {readOnly === null ? (
            <Button asChild variant="outline">
              <a href={payout.exportUrl(period)} download>
                {t('settle.export.payout')}
              </a>
            </Button>
          ) : (
            <Button variant="outline" disabled aria-describedby="export-reason">
              {t('settle.export.payout')}
            </Button>
          )}
          <Reason id="export-reason">{readOnly === null ? t('settle.export.payout.hint') : t(readOnly)}</Reason>
        </div>
        <div>
          <Button asChild variant="ghost">
            <a href={settle.linesCsvUrl(period)} download>
              {t('settle.export.lines')}
            </a>
          </Button>
        </div>
      </div>

      {batch.error ? (
        <LoadFailed />
      ) : batch.isPending ? (
        <TableSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState title={t('settle.empty')} body={t('settle.empty.body')} />
      ) : (
        <>
          <Table minWidth={900}>
            <thead>
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id} className="border-b border-[var(--border)]">
                  {hg.headers.map((h) => {
                    const sorted = h.column.getIsSorted();
                    const label = flexRender(h.column.columnDef.header, h.getContext());
                    return (
                      <Th
                        key={h.id}
                        aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : 'none'}
                      >
                        {h.column.getCanSort() && h.column.id !== 'open' ? (
                          <button
                            type="button"
                            onClick={h.column.getToggleSortingHandler()}
                            aria-label={t('settle.sort', { column: String(h.column.columnDef.header) })}
                            className={cn(
                              'inline-flex items-center gap-1 rounded-[var(--radius-sm)] uppercase tracking-[0.06em]',
                              sorted ? 'text-[var(--foreground)]' : '',
                            )}
                          >
                            {label}
                            <span aria-hidden="true" className="num">
                              {sorted === 'asc' ? '↑' : sorted === 'desc' ? '↓' : ''}
                            </span>
                          </button>
                        ) : (
                          label
                        )}
                      </Th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className="border-b border-[var(--border)] hover:bg-[var(--muted)]">
                  {row.getVisibleCells().map((cell) => (
                    <Td key={cell.id} className={cell.column.id === 'open' ? 'text-right' : ''}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </Td>
                  ))}
                </tr>
              ))}
            </tbody>
          </Table>
          <Panel className="mt-4 px-4 py-3">
            <p className="text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
              {t('settle.asStored', { currency: bills[0]?.currency ?? 'VND' })} {t('settle.withheld.note')}{' '}
              {t('settle.lines', { n: count(bills.length, i18n.language) })}.
            </p>
          </Panel>
        </>
      )}
    </SettleShell>
  );
}
