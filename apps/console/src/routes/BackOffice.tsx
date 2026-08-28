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
import { MESSAGES } from '@playerone/api/i18n';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button } from '../components/ui/button.tsx';
import { EmptyState, Panel, Problem, Skeleton } from '../components/ui/primitives.tsx';
import { durationShort } from '../lib/format.ts';
import { cn } from '../lib/cn.ts';
import {
  ApiError,
  backOffice,
  type BoAgreement,
  type BoCollector,
  type BoDevice,
  type BoPayoutDeclaration,
  type BoPayoutDeclared,
  type BoTask,
} from '../lib/api.ts';

type Tab = 'tasks' | 'collectors' | 'devices';
const TABS: Tab[] = ['tasks', 'collectors', 'devices'];

/**
 * The one place a server refusal becomes a sentence in the reader's language.
 *
 * The catalogue itself is the list of refusals it can name — a hand-kept copy
 * of the server's set is a third place to add a constraint to, and the one
 * nobody remembers. A 409 whose constraint has no sentence falls through to the
 * generic line, which is exactly what an unknown refusal should look like.
 */
const refusalKey = (error: unknown): string => {
  const detail = error instanceof ApiError ? error.detail : undefined;
  const key = `bo.refused.${String(detail)}`;
  return typeof detail === 'string' && key in MESSAGES.en ? key : 'bo.refused.unknown';
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
                {t('bo.cancel')}
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
  const [editing, setEditing] = useState<string | null>(null);
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

  const done = () => {
    onRefused(null);
    void client.invalidateQueries({ queryKey: ['bo', 'tasks'] });
  };
  const failed = (err: unknown) => onRefused(refusalKey(err));

  const publish = useMutation({
    mutationFn: ({ id, status }: { id: string; status: BoTask['status'] }) =>
      backOffice.setTaskStatus(id, status),
    onSuccess: done,
    onError: failed,
  });

  const edit = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Parameters<typeof backOffice.setTask>[1]) =>
      backOffice.setTask(id, body),
    onSuccess: () => {
      setEditing(null);
      done();
    },
    onError: failed,
  });

  const create = useMutation({
    mutationFn: backOffice.createTask,
    onSuccess: () => {
      setCreating(false);
      // Landed, so the next form is a new request rather than a replay of this one.
      setRequestId(crypto.randomUUID());
      done();
    },
    onError: failed,
  });

  /**
   * Closing the form ends this request; opening it starts a new one.
   *
   * The id is minted once and kept while the form is open, because a retry of
   * a submit that may already have landed has to carry the same one. It was
   * only rotated on success, so an id that came back `*_id_reused` stayed in
   * the form: cancel, reopen, and the operator resubmits the same poisoned id
   * for ever, with a page reload as the only way out. Cancelling is the
   * explicit "not this request" the rotation was missing.
   */
  const cancelOrOpen = () => {
    if (creating) setRequestId(crypto.randomUUID());
    setCreating(!creating);
  };

  if (error) return <LoadFailed />;
  if (isPending) return <TableSkeleton />;

  const tasks = data?.tasks ?? [];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant={creating ? 'ghost' : 'primary'} onClick={cancelOrOpen}>
          {creating ? t('bo.cancel') : t('bo.task.new')}
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
              max={2147483647}
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
            <Rows key={task.id}>
              <tr className="border-b border-[var(--border)] hover:bg-[var(--muted)]">
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
                <Td className="space-x-2 whitespace-nowrap text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditing(editing === task.id ? null : task.id)}
                  >
                    {editing === task.id ? t('bo.cancel') : t('bo.edit')}
                  </Button>
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

              {editing === task.id ? (
                <EditRow span={7}>
                  <form
                    className="grid gap-4 sm:grid-cols-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      const target = String(form.get('target') ?? '').trim();
                      edit.mutate({
                        id: task.id,
                        name: String(form.get('name')),
                        type: String(form.get('type')),
                        target_effective_duration_s: target === '' ? null : target,
                        max_concurrent_claimants: Number(form.get('claimants')),
                        /**
                         * Only a draft carries a price field. Once the task is
                         * published the figure is what its claimants agreed to
                         * and `tasks_price_frozen` refuses the change; sending
                         * it unchanged would still be sending it, and the first
                         * person to edit the number would meet a 409 they could
                         * have been told about by the form not being there.
                         */
                        ...(task.status === 'draft' ? { unit_price: String(form.get('price')) } : {}),
                      });
                    }}
                  >
                    <Field label={t('bo.task.name')} name="name" defaultValue={task.name} required />
                    <Field label={t('bo.task.type')} name="type" defaultValue={task.type ?? ''} required />
                    {task.status === 'draft' ? (
                      <Field
                        label={t('bo.task.rate')}
                        name="price"
                        defaultValue={task.unit_price}
                        required
                        inputMode="decimal"
                        pattern="\d{1,8}(\.\d{1,4})?"
                      />
                    ) : (
                      <p className="self-end text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">
                        {t('bo.task.priceFrozen')}
                      </p>
                    )}
                    <Field
                      label={t('bo.task.target')}
                      name="target"
                      defaultValue={task.target_effective_duration_s ?? ''}
                      inputMode="decimal"
                      pattern="\d{1,12}(\.\d{1,6})?"
                    />
                    <Field
                      label={t('bo.task.maxClaimants')}
                      name="claimants"
                      type="number"
                      min={1}
                      max={2147483647}
                      defaultValue={task.max_concurrent_claimants}
                      required
                    />
                    <div className="flex items-end">
                      <Button type="submit" variant="primary" disabled={edit.isPending}>
                        {edit.isPending ? t('bo.working') : t('bo.save')}
                      </Button>
                    </div>
                  </form>
                </EditRow>
              ) : null}
            </Rows>
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
  const [creating, setCreating] = useState(false);
  const [consenting, setConsenting] = useState<string | null>(null);
  const [declaring, setDeclaring] = useState<string | null>(null);
  const [declared, setDeclared] = useState<{ collectorId: string; result: BoPayoutDeclared } | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  const { data, isPending, error } = useQuery({
    queryKey: ['bo', 'collectors'],
    queryFn: backOffice.collectors,
  });

  const done = () => {
    onRefused(null);
    void client.invalidateQueries({ queryKey: ['bo', 'collectors'] });
  };
  const failed = (err: unknown) => onRefused(refusalKey(err));

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Parameters<typeof backOffice.setCollector>[1]) =>
      backOffice.setCollector(id, body),
    onSuccess: () => {
      setConsenting(null);
      done();
    },
    onError: failed,
  });

  const create = useMutation({
    mutationFn: backOffice.createCollector,
    onSuccess: () => {
      setCreating(false);
      setRequestId(crypto.randomUUID());
      done();
    },
    onError: failed,
  });

  /**
   * The counter's payout declaration. The answer is kept and shown rather than
   * only refreshing the row: ZaloPay may say "no wallet" or "past the KYC
   * limit" and hand back a page the collector has to open, and the collector is
   * standing at the counter for exactly as long as this reply takes.
   */
  const declare = useMutation({
    mutationFn: ({ collectorId, ...body }: { collectorId: string } & BoPayoutDeclaration) =>
      backOffice.declarePayoutAccount(collectorId, body),
    onSuccess: (result, sent) => {
      setDeclaring(null);
      if (result !== null) setDeclared({ collectorId: sent.collectorId, result });
      done();
    },
    onError: failed,
  });

  /**
   * Closing the form ends this request; opening it starts a new one.
   *
   * The id is minted once and kept while the form is open, because a retry of
   * a submit that may already have landed has to carry the same one. It was
   * only rotated on success, so an id that came back `*_id_reused` stayed in
   * the form: cancel, reopen, and the operator resubmits the same poisoned id
   * for ever, with a page reload as the only way out. Cancelling is the
   * explicit "not this request" the rotation was missing.
   */
  const cancelOrOpen = () => {
    if (creating) setRequestId(crypto.randomUUID());
    setCreating(!creating);
  };

  if (error) return <LoadFailed />;
  if (isPending) return <TableSkeleton />;

  const collectors = data?.collectors ?? [];
  const names = data?.required_agreements ?? [];
  const required = names.length;
  const held = (c: BoCollector) =>
    new Set(c.agreements.map((a) => a.agreement).filter((a) => names.includes(a)));
  const exam = (result: BoCollector['exam_result']) =>
    result === null ? t('bo.collector.exam.none') : t(`bo.collector.exam.${result}`);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button variant={creating ? 'ghost' : 'primary'} onClick={cancelOrOpen}>
          {creating ? t('bo.cancel') : t('bo.collector.new')}
        </Button>
      </div>

      {creating ? (
        <Panel className="mb-6 p-5">
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              create.mutate({
                id: requestId,
                external_ref: String(form.get('ref')),
                status: String(form.get('status')) as BoCollector['status'],
              });
            }}
          >
            <Field label={t('bo.collector.ref')} name="ref" required />
            <Select
              label={t('bo.collector.status')}
              name="status"
              defaultValue="pending"
              options={(['pending', 'qualified', 'suspended'] as const).map((s) => ({
                value: s,
                label: t(`bo.collector.status.${s}`),
              }))}
            />
            <div className="flex items-end">
              <Button type="submit" variant="primary" disabled={create.isPending}>
                {create.isPending ? t('bo.working') : t('bo.collector.create')}
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      {collectors.length === 0 ? (
        <EmptyState title={t('bo.empty')} body={t('bo.collector.gate')} />
      ) : (
        <Table
          head={[
            t('bo.collector.ref'),
            t('bo.collector.status'),
            t('bo.collector.exam'),
            t('bo.collector.agreements'),
            t('bo.collector.payout'),
            '',
          ]}
        >
          {collectors.map((c) => {
            const accepted = held(c);
            const missing = names.filter((n) => !accepted.has(n));
            return (
              <Rows key={c.id}>
                <tr className="border-b border-[var(--border)] hover:bg-[var(--muted)]">
                  <Td className="num font-semibold">{c.external_ref}</Td>
                  <Td>
                    <select
                      className="h-8 rounded-[var(--radius-sm)] border border-[var(--border-strong)] bg-[var(--card)] px-2 text-[0.8125rem]"
                      aria-label={t('bo.collector.status')}
                      value={c.status}
                      disabled={update.isPending}
                      onChange={(e) =>
                        update.mutate({ id: c.id, status: e.target.value as BoCollector['status'] })
                      }
                    >
                      {(['pending', 'qualified', 'suspended'] as const).map((s) => (
                        <option key={s} value={s}>
                          {t(`bo.collector.status.${s}`)}
                        </option>
                      ))}
                    </select>
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
                  <Td>
                    <span className="num">
                      {accepted.size} / {required}
                    </span>
                    {missing.length > 0 ? (
                      <span className="ml-2 text-[0.8125rem] text-[var(--muted-foreground)]">
                        {t('bo.collector.missing')}:{' '}
                        {missing.map((m) => t(`bo.collector.agreement.${m}`)).join(', ')}
                      </span>
                    ) : null}
                  </Td>
                  {/*
                    The whole point of the column: a collector with no account
                    is approved and then never paid, and this is where an
                    operator finds them. `reject` tone, because it is the one
                    state on this row that stops money.
                  */}
                  <Td>
                    {c.payout_account === null ? (
                      <Pill tone="reject">{t('bo.collector.payout.none')}</Pill>
                    ) : (
                      <>
                        <Pill tone={c.payout_account.verify_status === 'verified' ? 'pass' : 'partial'}>
                          {t(`settle.verify.${c.payout_account.verify_status}`)}
                        </Pill>
                        <span className="num ml-2 text-[0.8125rem] text-[var(--muted-foreground)]">
                          {c.payout_account.phone_masked ||
                            t(`bo.collector.payout.method.${c.payout_account.method}`)}
                        </span>
                      </>
                    )}
                  </Td>
                  <Td className="space-x-2 whitespace-nowrap text-right">
                    <Button
                      size="sm"
                      variant={c.payout_account === null ? 'secondary' : 'ghost'}
                      onClick={() => {
                        setDeclared(null);
                        setDeclaring(declaring === c.id ? null : c.id);
                      }}
                    >
                      {declaring === c.id
                        ? t('bo.cancel')
                        : c.payout_account === null
                          ? t('bo.collector.payout.declare')
                          : t('bo.collector.payout.redeclare')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConsenting(consenting === c.id ? null : c.id)}
                    >
                      {consenting === c.id ? t('bo.cancel') : t('bo.collector.recordAgreement')}
                    </Button>
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
                    {c.exam_result === 'fail' ? null : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={update.isPending}
                        onClick={() =>
                          update.mutate({
                            id: c.id,
                            exam: { result: 'fail', decided_at: new Date().toISOString() },
                          })
                        }
                      >
                        {t('bo.collector.markFail')}
                      </Button>
                    )}
                    {c.exam_result === null ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={update.isPending}
                        onClick={() => update.mutate({ id: c.id, exam: null })}
                      >
                        {t('bo.collector.clearExam')}
                      </Button>
                    )}
                  </Td>
                </tr>

                {declaring === c.id ? (
                  <EditRow span={6}>
                    <PayoutDeclaration
                      busy={declare.isPending}
                      onSubmit={(body) => declare.mutate({ collectorId: c.id, ...body })}
                    />
                  </EditRow>
                ) : null}

                {declared?.collectorId === c.id ? (
                  <EditRow span={6}>
                    <p className="text-[0.875rem] leading-relaxed">
                      {t('bo.collector.payout.declared')}{' '}
                      <span className="font-semibold">{t(`settle.verify.${declared.result.verify_status}`)}</span>
                    </p>
                    {/*
                      -101 and -406 are the two answers a collector can act on,
                      and the page is the only way they can. Shown as a link
                      rather than opened: the operator decides when.
                    */}
                    {(declared.result.onboarding_url ?? declared.result.reform_url) !== null ? (
                      <a
                        className="mt-2 inline-block text-[0.875rem] font-semibold underline"
                        href={(declared.result.onboarding_url ?? declared.result.reform_url)!}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        {t('bo.collector.payout.open')}
                      </a>
                    ) : null}
                  </EditRow>
                ) : null}

                {consenting === c.id ? (
                  <EditRow span={6}>
                    <form
                      className="grid gap-4 sm:grid-cols-3"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const form = new FormData(e.currentTarget);
                        update.mutate({
                          id: c.id,
                          agreements: [
                            {
                              agreement: String(form.get('agreement')),
                              version: String(form.get('version')),
                              /**
                               * A `datetime-local` value has no zone, and the
                               * server wants one. It is read as the operator's
                               * own time, which is where the person signing was.
                               */
                              accepted_at: new Date(String(form.get('at'))).toISOString(),
                            } as BoAgreement,
                          ],
                        });
                      }}
                    >
                      <Select
                        label={t('bo.collector.agreement')}
                        name="agreement"
                        defaultValue={missing[0] ?? names[0] ?? ''}
                        options={names.map((n) => ({
                          value: n,
                          label: t(`bo.collector.agreement.${n}`),
                        }))}
                      />
                      <Field label={t('bo.collector.version')} name="version" required />
                      <Field
                        label={t('bo.collector.acceptedAt')}
                        name="at"
                        type="datetime-local"
                        defaultValue={localNow()}
                        required
                      />
                      <div className="flex items-end sm:col-span-3">
                        <Button type="submit" variant="primary" disabled={update.isPending}>
                          {update.isPending ? t('bo.working') : t('bo.save')}
                        </Button>
                      </div>
                    </form>
                  </EditRow>
                ) : null}
              </Rows>
            );
          })}
        </Table>
      )}
      <p className="mt-4 max-w-[70ch] text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
        {t('bo.collector.gate')}
      </p>
    </>
  );
}

/**
 * The declaration form the operator fills in with the collector in front of
 * them.
 *
 * The id is minted once per open form, for the same reason every other create
 * on this screen does it: a retry of a submit whose reply was lost has to
 * carry the same one, and a fresh id on the second click is a second account.
 *
 * The fields follow the method because the server refuses the other
 * combinations by name (`payout_account_declaration_invalid`), and a form that
 * can only produce refusals is a form that wastes the collector's visit. The
 * shape rules themselves are not repeated here — the `pattern` is the same
 * ten-digit rule the server states, and the server is still the one that
 * decides.
 */
function PayoutDeclaration({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (body: BoPayoutDeclaration) => void;
}) {
  const { t } = useTranslation();
  const [method, setMethod] = useState<BoPayoutDeclaration['method']>('WALLET');
  const [id] = useState(() => crypto.randomUUID());

  return (
    <form
      className="grid gap-4 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        const declared_name = String(form.get('holder') ?? '').trim();
        onSubmit(
          method === 'WALLET'
            ? { id, method, declared_name, phone: String(form.get('phone') ?? '').trim() }
            : {
                id,
                method,
                declared_name,
                bank_code: String(form.get('bank') ?? '').trim(),
                account_no: String(form.get('account') ?? '').trim(),
              },
        );
      }}
    >
      <Select
        label={t('bo.collector.payout.method')}
        name="method"
        value={method}
        onChange={(e) => setMethod(e.target.value as BoPayoutDeclaration['method'])}
        options={(['WALLET', 'BANK_ACCOUNT', 'BANK_CARD'] as const).map((m) => ({
          value: m,
          label: t(`bo.collector.payout.method.${m}`),
        }))}
      />
      <Field label={t('bo.collector.payout.holder')} name="holder" required />
      {method === 'WALLET' ? (
        <Field
          label={t('bo.collector.payout.phone')}
          name="phone"
          required
          inputMode="numeric"
          pattern="0\d{9}"
        />
      ) : (
        <>
          <Field label={t('bo.collector.payout.bankCode')} name="bank" required />
          <Field
            label={t('bo.collector.payout.accountNo')}
            name="account"
            required
            inputMode="numeric"
            pattern="\d{4,32}"
          />
        </>
      )}
      <div className="flex items-end sm:col-span-3">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? t('bo.working') : t('bo.collector.payout.declare')}
        </Button>
      </div>
      <p className="max-w-[70ch] text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)] sm:col-span-3">
        {t('bo.collector.payout.note')}
      </p>
    </form>
  );
}

/* -------------------------------------------------------------------------
   Devices (BO-04, SEC-04)
   ---------------------------------------------------------------------- */

function Devices({ onRefused }: { onRefused: (key: string | null) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

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
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Parameters<typeof backOffice.setDevice>[1]) =>
      backOffice.setDevice(id, body),
    onSuccess: () => {
      setEditing(null);
      done();
    },
    onError: failed,
  });
  const create = useMutation({
    mutationFn: backOffice.createDevice,
    onSuccess: () => {
      setCreating(false);
      setRequestId(crypto.randomUUID());
      done();
    },
    onError: failed,
  });

  /**
   * Closing the form ends this request; opening it starts a new one.
   *
   * The id is minted once and kept while the form is open, because a retry of
   * a submit that may already have landed has to carry the same one. It was
   * only rotated on success, so an id that came back `*_id_reused` stayed in
   * the form: cancel, reopen, and the operator resubmits the same poisoned id
   * for ever, with a page reload as the only way out. Cancelling is the
   * explicit "not this request" the rotation was missing.
   */
  const cancelOrOpen = () => {
    if (creating) setRequestId(crypto.randomUUID());
    setCreating(!creating);
  };

  if (devices.error) return <LoadFailed />;
  if (devices.isPending) return <TableSkeleton />;

  const rows = devices.data?.devices ?? [];
  const types = devices.data?.device_types ?? [];
  const roll = collectors.data?.collectors ?? [];

  return (
    <>
      <div className="mb-4 flex justify-end">
        <Button
          variant={creating ? 'ghost' : 'primary'}
          disabled={types.length === 0}
          onClick={cancelOrOpen}
        >
          {creating ? t('bo.cancel') : t('bo.device.new')}
        </Button>
      </div>

      {/*
        The roll is a second query, and a failed one used to show as a bind
        control that was simply disabled — indistinguishable from "there is
        nobody to bind to". Saying which of the two it is costs one line.
      */}
      {collectors.error ? (
        <div className="mb-4">
          <Problem title={t('bo.loadFailed')} body={t('bo.device.rollFailed')} />
        </div>
      ) : null}

      {creating ? (
        <Panel className="mb-6 p-5">
          <form
            className="grid gap-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const firmware = String(form.get('firmware') ?? '').trim();
              create.mutate({
                id: requestId,
                device_type_id: String(form.get('type')),
                hardware_serial: String(form.get('serial')),
                ...(firmware === '' ? {} : { firmware_version: firmware }),
              });
            }}
          >
            <Select
              label={t('bo.device.type')}
              name="type"
              defaultValue={types[0]?.id ?? ''}
              options={types.map((ty) => ({ value: ty.id, label: ty.code }))}
            />
            <Field label={t('bo.device.serial')} name="serial" required />
            <Field label={t('bo.device.firmware')} name="firmware" />
            <div className="flex items-end sm:col-span-3">
              <Button type="submit" variant="primary" disabled={create.isPending}>
                {create.isPending ? t('bo.working') : t('bo.device.create')}
              </Button>
            </div>
          </form>
        </Panel>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={t('bo.empty')} body={t('bo.intro')} />
      ) : (
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
            <Rows key={d.id}>
              <tr className="border-b border-[var(--border)] hover:bg-[var(--muted)]">
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
                    onClick={() => setEditing(editing === d.id ? null : d.id)}
                  >
                    {editing === d.id ? t('bo.cancel') : t('bo.edit')}
                  </Button>
                </Td>
              </tr>

              {editing === d.id ? (
                <EditRow span={6}>
                  <form
                    className="grid gap-4 sm:grid-cols-3"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const form = new FormData(e.currentTarget);
                      const firmware = String(form.get('firmware') ?? '').trim();
                      const note = String(form.get('note') ?? '').trim();
                      update.mutate({
                        id: d.id,
                        firmware_version: firmware === '' ? null : firmware,
                        fault_note: note === '' ? null : note,
                        status: String(form.get('state')) as BoDevice['status'],
                      });
                    }}
                  >
                    <Field
                      label={t('bo.device.firmware')}
                      name="firmware"
                      defaultValue={d.firmware_version ?? ''}
                    />
                    <Select
                      label={t('bo.device.state')}
                      name="state"
                      defaultValue={d.status}
                      options={(['active', 'faulty', 'retired'] as const).map((s) => ({
                        value: s,
                        label: t(`bo.device.state.${s}`),
                      }))}
                    />
                    <Field
                      label={t('bo.device.faultNote')}
                      name="note"
                      defaultValue={d.fault_note ?? ''}
                      hint={t('bo.device.retireNote')}
                    />
                    <div className="flex items-end sm:col-span-3">
                      <Button type="submit" variant="primary" disabled={update.isPending}>
                        {update.isPending ? t('bo.working') : t('bo.save')}
                      </Button>
                    </div>
                  </form>
                </EditRow>
              ) : null}
            </Rows>
          ))}
        </Table>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------
   The small shared pieces of this screen.
   ---------------------------------------------------------------------- */

/** `<input type="datetime-local">` wants local wall-clock, with no zone on it. */
function localNow(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

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

/** A row and the editor that opens under it, which `<tbody>` needs as siblings. */
function Rows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function EditRow({ span, children }: { span: number; children: React.ReactNode }) {
  return (
    <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
      <td colSpan={span} className="px-4 py-4">
        {children}
      </td>
    </tr>
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

const FIELD_LABEL =
  'text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]';
const FIELD_INPUT =
  'mt-1 h-10 w-full rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--card)] px-3 text-[0.9375rem]';

function Field({
  label,
  hint,
  ...rest
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className={FIELD_LABEL}>{label}</span>
      <input {...rest} className={FIELD_INPUT} />
      {hint ? (
        <span className="mt-1 block text-[0.75rem] leading-snug text-[var(--muted-foreground)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

function Select({
  label,
  options,
  ...rest
}: { label: string; options: { value: string; label: string }[] } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className={FIELD_LABEL}>{label}</span>
      <select {...rest} className={FIELD_INPUT}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
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
