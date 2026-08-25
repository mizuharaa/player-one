/**
 * The back office: tasks, collectors and devices (BO-01 → BO-04).
 *
 * One screen and three tabs rather than three destinations in the top bar. The
 * bar already carries six, and these three are one job — an operations person
 * publishes a task, checks who is qualified to claim it, and hands them the
 * hardware — so splitting them across the navigation would cost three clicks
 * to do one thing and make the bar unreadable on a laptop.
 *
 * Two things this screen deliberately does not do.
 *
 * It **never decides whether an action is allowed**. Whether a task can be
 * published, whether a collector may claim, whether a device can be retired —
 * all of that is a trigger or a CHECK in migration 0006, and the screen finds
 * out by asking. A button greyed out on the client's own reading of the rules
 * is a second copy of the rules, and it is the copy that goes stale.
 *
 * And it **never formats a unit price as money**. The price is a decimal string
 * that multiplies into every payment; printing it through `Intl` would show a
 * rounded figure beside the exact one the settlement uses. It is shown as
 * stored, in the mono column, with a line saying so.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button } from '../components/ui/button.tsx';
import { EmptyState, Panel, Problem, Skeleton } from '../components/ui/primitives.tsx';
import { durationShort } from '../lib/format.ts';
import { cn } from '../lib/cn.ts';
import {
  ApiError,
  backOffice,
  type BoCollector,
  type BoDevice,
  type BoTask,
} from '../lib/api.ts';

type Tab = 'tasks' | 'collectors' | 'devices';
const TABS: Tab[] = ['tasks', 'collectors', 'devices'];

/** The one place a server refusal becomes a sentence in the reader's language. */
const REFUSAL_KEYS = new Set([
  'task_claims_capacity',
  'task_claims_exam_gate',
  'task_claims_qualified_gate',
  'task_claims_consent_gate',
  'task_claims_published_gate',
  'task_claims_live_key',
  'task_claims_id_reused',
  'tasks_status_transition',
  'tasks_price_frozen',
  'collector_agreements_append_only',
  'devices_retired_unbound_check',
  'collectors_external_ref_key',
  'devices_hardware_serial_key',
  'device_already_bound',
]);

const refusalKey = (error: unknown): string => {
  const detail = error instanceof ApiError ? error.detail : undefined;
  return typeof detail === 'string' && REFUSAL_KEYS.has(detail)
    ? `bo.refused.${detail}`
    : 'bo.refused.unknown';
};

export function BackOfficeScreen() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('tasks');
  const [refused, setRefused] = useState<string | null>(null);

  return (
    <AppShell>
      <header className="max-w-[62ch]">
        <h1 className="text-[2.0625rem] font-extrabold leading-[1.12] tracking-[-0.03em]">
          {t('bo.title')}
        </h1>
        <p className="mt-3 text-[1.0625rem] leading-relaxed text-[var(--muted-foreground)]">
          {t('bo.intro')}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-1" role="tablist">
        {TABS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            aria-selected={tab === name}
            onClick={() => {
              setTab(name);
              setRefused(null);
            }}
            className={cn(
              'rounded-full px-4 py-1.5 text-[0.9375rem] font-semibold',
              'transition-colors duration-150 ease-[var(--ease)]',
              tab === name
                ? 'bg-[var(--sun-50)] text-[var(--sun-700)]'
                : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
            )}
          >
            {t(`bo.tab.${name}`)}
          </button>
        ))}
      </div>

      {refused ? (
        <div className="mt-5">
          <Problem
            title={t('bo.refused')}
            body={t(refused)}
            action={
              <Button variant="outline" size="sm" onClick={() => setRefused(null)}>
                {t('bo.task.cancel')}
              </Button>
            }
          />
        </div>
      ) : null}

      <div className="mt-6">
        {tab === 'tasks' ? <Tasks onRefused={setRefused} /> : null}
        {tab === 'collectors' ? <Collectors onRefused={setRefused} /> : null}
        {tab === 'devices' ? <Devices onRefused={setRefused} /> : null}
      </div>
    </AppShell>
  );
}

/* -------------------------------------------------------------------------
   Tasks (BO-01, BO-02)
   ---------------------------------------------------------------------- */

function Tasks({ onRefused }: { onRefused: (key: string | null) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  /**
   * The id this form will submit under, minted once and kept until a create
   * actually lands. See the comment at the `id:` below for why a retry has to
   * carry the same one.
   */
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const { data, isPending, error } = useQuery({
    queryKey: ['bo', 'tasks'],
    queryFn: backOffice.tasks,
  });

  const publish = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BoTask['status'] }) =>
      backOffice.setTaskStatus(id, status),
    onSuccess: () => {
      onRefused(null);
      void client.invalidateQueries({ queryKey: ['bo', 'tasks'] });
    },
    onError: (err) => onRefused(refusalKey(err)),
  });

  const create = useMutation({
    mutationFn: backOffice.createTask,
    onSuccess: () => {
      onRefused(null);
      setCreating(false);
      // Landed, so the next form is a new request rather than a replay of this one.
      setRequestId(crypto.randomUUID());
      void client.invalidateQueries({ queryKey: ['bo', 'tasks'] });
    },
    onError: (err) => onRefused(refusalKey(err)),
  });

  if (error) return <LoadFailed />;
  if (isPending) return <TableSkeleton />;

  const tasks = data?.tasks ?? [];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant={creating ? 'ghost' : 'primary'} onClick={() => setCreating(!creating)}>
          {creating ? t('bo.task.cancel') : t('bo.task.new')}
        </Button>
      </div>

      {creating ? (
        <Panel className="mb-6 p-5">
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const target = String(form.get('target') ?? '').trim();
              create.mutate({
                /**
                 * Held for as long as the form is open, not minted per submit.
                 * The id is what makes a create idempotent, so a request whose
                 * reply was lost has to be retried under the SAME id — a fresh
                 * one on the second click is not a retry, it is a second task.
                 */
                id: requestId,
                name: String(form.get('name')),
                type: String(form.get('type')),
                unit_price: String(form.get('price')),
                ...(target === '' ? {} : { target_effective_duration_s: target }),
                max_concurrent_claimants: Number(form.get('claimants')),
              });
            }}
          >
            <Field label={t('bo.task.name')} name="name" required />
            <Field label={t('bo.task.type')} name="type" required />
            <Field
              label={t('bo.task.rate')}
              name="price"
              required
              inputMode="decimal"
              pattern="\d{1,8}(\.\d{1,4})?"
              hint={t('bo.task.priceNote')}
            />
            <Field label={t('bo.task.target')} name="target" inputMode="decimal" pattern="\d{1,12}(\.\d{1,6})?" />
            <Field
              label={t('bo.task.maxClaimants')}
              name="claimants"
              type="number"
              min={1}
              defaultValue={1}
              required
            />
            <div className="flex items-end">
              <Button type="submit" variant="primary" disabled={create.isPending}>
                {create.isPending ? t('bo.working') : t('bo.task.create')}
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      {tasks.length === 0 ? (
        <EmptyState title={t('bo.empty')} body={t('bo.intro')} />
      ) : (
        <Table
          head={[
            t('bo.task.name'),
            t('bo.task.type'),
            t('bo.task.rate'),
            t('bo.task.target'),
            t('bo.task.claimants'),
            t('bo.task.state'),
            '',
          ]}
        >
          {tasks.map((task) => (
            <tr key={task.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]">
              <Td className="font-semibold">{task.name}</Td>
              <Td className="text-[var(--muted-foreground)]">{task.type ?? '—'}</Td>
              {/* As stored. Not through Intl: this number multiplies into a payment. */}
              <Td className="num text-[var(--tech-600)]">{task.unit_price}</Td>
              <Td className="num">{durationShort(task.target_effective_duration_s)}</Td>
              <Td className="num">
                {task.claimants} / {task.max_concurrent_claimants}
              </Td>
              <Td>
                <Pill tone={task.status === 'published' ? 'pass' : task.status === 'draft' ? 'partial' : 'reject'}>
                  {t(`bo.task.state.${task.status}`)}
                </Pill>
              </Td>
              <Td className="text-right">
                {task.status === 'draft' ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={publish.isPending}
                    onClick={() => publish.mutate({ id: task.id, status: 'published' })}
                  >
                    {t('bo.task.publish')}
                  </Button>
                ) : null}
                {task.status === 'published' ? (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={publish.isPending}
                    onClick={() => publish.mutate({ id: task.id, status: 'taken_down' })}
                  >
                    {t('bo.task.takeDown')}
                  </Button>
                ) : null}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------
   Collectors (BO-03, APP-02/04/05, PRV-01)
   ---------------------------------------------------------------------- */

function Collectors({ onRefused }: { onRefused: (key: string | null) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();

  const { data, isPending, error } = useQuery({
    queryKey: ['bo', 'collectors'],
    queryFn: backOffice.collectors,
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Parameters<typeof backOffice.setCollector>[1]) =>
      backOffice.setCollector(id, body),
    onSuccess: () => {
      onRefused(null);
      void client.invalidateQueries({ queryKey: ['bo', 'collectors'] });
    },
    onError: (err) => onRefused(refusalKey(err)),
  });

  if (error) return <LoadFailed />;
  if (isPending) return <TableSkeleton />;

  const collectors = data?.collectors ?? [];
  const names = data?.required_agreements ?? [];
  const required = names.length;
  const accepted = (c: BoCollector) =>
    new Set(c.agreements.map((a) => a.agreement).filter((a) => names.includes(a))).size;
  const exam = (result: BoCollector['exam_result']) =>
    result === null ? t('bo.collector.exam.none') : t(`bo.collector.exam.${result}`);

  if (collectors.length === 0) return <EmptyState title={t('bo.empty')} body={t('bo.collector.gate')} />;

  return (
    <>
      <Table
        head={[
          t('bo.collector.ref'),
          t('bo.collector.status'),
          t('bo.collector.exam'),
          t('bo.collector.agreements'),
          '',
        ]}
      >
        {collectors.map((c) => (
          <tr key={c.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]">
            <Td className="num font-semibold">{c.external_ref}</Td>
            <Td>
              <Pill tone={c.status === 'qualified' ? 'pass' : c.status === 'pending' ? 'partial' : 'reject'}>
                {t(`bo.collector.status.${c.status}`)}
              </Pill>
            </Td>
            <Td>
              <Pill tone={c.exam_result === 'pass' ? 'pass' : c.exam_result === 'fail' ? 'reject' : 'partial'}>
                {exam(c.exam_result)}
              </Pill>
            </Td>
            {/*
              PRV-01 wants all six, and the count has to be of distinct
              agreements rather than of rows. Acceptances are append-only, so a
              collector who accepted two versions of the privacy policy has two
              rows for one agreement — and `agreements.length` then reads 6 / 6
              while one of the six has never been accepted at all.
            */}
            <Td className="num">
              {accepted(c)} / {required}
            </Td>
            <Td className="space-x-2 text-right">
              {c.exam_result === 'pass' ? null : (
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={update.isPending}
                  onClick={() =>
                    update.mutate({
                      id: c.id,
                      exam: { result: 'pass', decided_at: new Date().toISOString() },
                    })
                  }
                >
                  {t('bo.collector.markPass')}
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({
                    id: c.id,
                    status: c.status === 'suspended' ? 'qualified' : 'suspended',
                  })
                }
              >
                {c.status === 'suspended' ? t('bo.collector.qualify') : t('bo.collector.suspend')}
              </Button>
            </Td>
          </tr>
        ))}
      </Table>
      <p className="mt-4 max-w-[70ch] text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
        {t('bo.collector.gate')}
      </p>
    </>
  );
}

/* -------------------------------------------------------------------------
   Devices (BO-04, SEC-04)
   ---------------------------------------------------------------------- */

function Devices({ onRefused }: { onRefused: (key: string | null) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();

  const devices = useQuery({ queryKey: ['bo', 'devices'], queryFn: backOffice.devices });
  /** Binding needs the roll of collectors; the same list the other tab reads. */
  const collectors = useQuery({ queryKey: ['bo', 'collectors'], queryFn: backOffice.collectors });

  const done = () => {
    onRefused(null);
    void client.invalidateQueries({ queryKey: ['bo', 'devices'] });
  };
  const failed = (err: unknown) => onRefused(refusalKey(err));

  const bind = useMutation({
    mutationFn: ({ id, collectorId }: { id: string; collectorId: string }) =>
      backOffice.bindDevice(id, collectorId),
    onSuccess: done,
    onError: failed,
  });
  const unbind = useMutation({ mutationFn: backOffice.unbindDevice, onSuccess: done, onError: failed });
  const setState = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BoDevice['status'] }) =>
      backOffice.setDevice(id, { status }),
    onSuccess: done,
    onError: failed,
  });

  if (devices.error) return <LoadFailed />;
  if (devices.isPending) return <TableSkeleton />;

  const rows = devices.data?.devices ?? [];
  const roll = collectors.data?.collectors ?? [];
  if (rows.length === 0) return <EmptyState title={t('bo.empty')} body={t('bo.intro')} />;

  return (
    <Table
      head={[
        t('bo.device.serial'),
        t('bo.device.type'),
        t('bo.device.firmware'),
        t('bo.device.state'),
        t('bo.device.holder'),
        '',
      ]}
    >
      {rows.map((d) => (
        <tr key={d.id} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]">
          <Td className="num font-semibold">{d.hardware_serial}</Td>
          <Td className="text-[var(--muted-foreground)]">{d.device_type_code ?? '—'}</Td>
          <Td className="num">{d.firmware_version ?? '—'}</Td>
          <Td>
            <Pill tone={d.status === 'active' ? 'pass' : d.status === 'faulty' ? 'reject' : 'partial'}>
              {t(`bo.device.state.${d.status}`)}
            </Pill>
            {d.fault_note ? (
              <span className="ml-2 text-[0.8125rem] text-[var(--muted-foreground)]">{d.fault_note}</span>
            ) : null}
          </Td>
          <Td className="num">
            {d.bound_collector_ref ?? (
              <span className="font-sans text-[var(--faint-foreground)]">{t('bo.device.unbound')}</span>
            )}
          </Td>
          <Td className="space-x-2 whitespace-nowrap text-right">
            {d.bound_collector_id === null ? (
              <select
                className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--card)] px-2 text-[0.8125rem]"
                aria-label={t('bo.device.bind')}
                value=""
                disabled={bind.isPending || roll.length === 0}
                onChange={(e) => bind.mutate({ id: d.id, collectorId: e.target.value })}
              >
                <option value="" disabled>
                  {t('bo.device.bind')}
                </option>
                {roll.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.external_ref}
                  </option>
                ))}
              </select>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={unbind.isPending}
                onClick={() => unbind.mutate(d.id)}
              >
                {t('bo.device.unbind')}
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={setState.isPending}
              onClick={() =>
                setState.mutate({ id: d.id, status: d.status === 'faulty' ? 'active' : 'faulty' })
              }
            >
              {d.status === 'faulty' ? t('bo.device.markActive') : t('bo.device.markFaulty')}
            </Button>
          </Td>
        </tr>
      ))}
    </Table>
  );
}

/* -------------------------------------------------------------------------
   The small shared pieces of this screen.
   ---------------------------------------------------------------------- */

function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <Panel className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-left">
          <thead>
            <tr className="border-b border-[var(--border)]">
              {head.map((label, i) => (
                <th
                  key={`${label}-${i}`}
                  className="px-4 py-2.5 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>{children}</tbody>
        </table>
      </div>
    </Panel>
  );
}

function Td({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn('px-4 py-3 text-[0.875rem]', className)}>{children}</td>;
}

function Pill({ tone, children }: { tone: 'pass' | 'partial' | 'reject'; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[0.75rem] font-bold"
      style={{ color: `var(--${tone})`, backgroundColor: `var(--${tone}-bg)` }}
    >
      {children}
    </span>
  );
}

function Field({
  label,
  hint,
  ...rest
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]">
        {label}
      </span>
      <input
        {...rest}
        className="mt-1 h-10 w-full rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--card)] px-3 text-[0.9375rem]"
      />
      {hint ? (
        <span className="mt-1 block text-[0.75rem] leading-snug text-[var(--muted-foreground)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function TableSkeleton() {
  return (
    <Panel className="p-4">
      {[0, 1, 2, 3, 4].map((i) => (
        <Skeleton key={i} className="mb-2 h-10 w-full last:mb-0" />
      ))}
    </Panel>
  );
}

function LoadFailed() {
  const { t } = useTranslation();
  return <Problem title={t('bo.loadFailed')} body={t('bo.loadFailed.body')} />;
}
