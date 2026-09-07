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
import { durationShort, localNow } from '../lib/format.ts';
import { refusalKey } from './refusal.ts';
import { TaskAssign } from './TaskAssign.tsx';
import { cn } from '../lib/cn.ts';
import { uuid } from '../lib/uuid.ts';
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

export function BackOfficeScreen() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('tasks');
  const [refused, setRefused] = useState<unknown>(null);

  return (
    <AppShell>
      <header className="border-b border-[var(--foreground)] pb-5">
        <h1 className="text-[2.0625rem] font-extrabold leading-[1.12] tracking-[-0.03em]">
          {t('bo.title')}
        </h1>
        <p className="mt-3 max-w-[62ch] text-[1.0625rem] leading-relaxed text-[var(--muted-foreground)]">
          {t('bo.intro')}
        </p>
      </header>

      {/*
        Three tables and no hero. This screen is an operations desk, not a
        dashboard: the quietest thing that answers "which of the three am I
        looking at" is the right one, and the selected tab is inverted ink
        rather than a brand tint so sun keeps meaning *action* on a page whose
        primary button sits four inches below it.
      */}
      <div data-guide="backoffice.tabs" className="mt-6 flex flex-wrap items-center gap-1" role="tablist">
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
                ? 'bg-[var(--foreground)] text-[var(--background)]'
                : 'text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
            )}
          >
            {t(`bo.tab.${name}`)}
          </button>
        ))}
      </div>

      {refused !== null ? (
        <div className="mt-5">
          <Problem
            title={t('bo.refused')}
            body={t(refusalKey(refused))}
            reference={refused instanceof ApiError ? refused.ref : undefined}
            action={
              <Button variant="outline" size="sm" onClick={() => setRefused(null)}>
                {t('bo.cancel')}
              </Button>
            }
          />
        </div>
      ) : null}

      <div className="mt-5">
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

function Tasks({ onRefused }: { onRefused: (error: unknown) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  /**
   * Creating a task is a sequence, so it is a wizard and not a row of inputs
   * above the table.
   *
   * There used to be an inline create form here. It is gone rather than kept
   * beside the wizard: two ways to create the same row is the duplication that
   * ends with one of them missing a field, and the sequence the wizard walks —
   * create, publish, claim, hand out a camera — is the order the server's own
   * triggers impose. The table is untouched; it is what this tab shows when the
   * wizard is closed.
   */
  const [assigning, setAssigning] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);

  const { data, isPending, error } = useQuery({
    queryKey: ['bo', 'tasks'],
    queryFn: backOffice.tasks,
  });

  /** The wizard needs the roll and the fleet: it claims for people and hands out cameras. */
  const roll = useQuery({
    queryKey: ['bo', 'collectors'],
    queryFn: backOffice.collectors,
    enabled: assigning,
  });
  const fleet = useQuery({
    queryKey: ['bo', 'devices'],
    queryFn: backOffice.devices,
    enabled: assigning,
  });

  const done = () => {
    onRefused(null);
    void client.invalidateQueries({ queryKey: ['bo', 'tasks'] });
  };
  const failed = (err: unknown) => onRefused(err);

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

  if (assigning) {
    if (roll.isPending || fleet.isPending) return <TableSkeleton />;
    if (roll.error) return <LoadFailed error={roll.error} />;
    if (fleet.error) return <LoadFailed error={fleet.error} />;
    return (
      <TaskAssign
        collectors={roll.data?.collectors ?? []}
        devices={fleet.data?.devices ?? []}
        onLanded={done}
        onClose={() => {
          setAssigning(false);
          done();
        }}
      />
    );
  }

  if (error) return <LoadFailed error={error} />;
  if (isPending) return <TableSkeleton />;

  const tasks = data?.tasks ?? [];

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setAssigning(true)}>
          {t('bo.task.new')}
        </Button>
      </div>

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
              <tr className="border-b border-[var(--border)] transition-colors duration-150 ease-[var(--ease)] hover:bg-[var(--muted)]">
                <Td className="font-semibold">{task.name}</Td>
                <Td className="text-[var(--muted-foreground)]">{task.type ?? '—'}</Td>
                {/* As stored. Not through Intl: this number multiplies into a payment. */}
                <Td className="num text-[var(--tech-ink)]">{task.unit_price}</Td>
                <Td className="num">{durationShort(task.target_effective_duration_s)}</Td>
                <Td className="num">
                  {task.claimants} / {task.max_concurrent_claimants}
                </Td>
                <Td>
                  <Pill tone={task.status === 'published' ? 'live' : task.status === 'draft' ? 'waiting' : 'stopped'}>
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

function Collectors({ onRefused }: { onRefused: (error: unknown) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [consenting, setConsenting] = useState<string | null>(null);
  const [declaring, setDeclaring] = useState<string | null>(null);
  const [declared, setDeclared] = useState<{ collectorId: string; result: BoPayoutDeclared } | null>(null);
  const [requestId, setRequestId] = useState(() => uuid());

  const { data, isPending, error } = useQuery({
    queryKey: ['bo', 'collectors'],
    queryFn: backOffice.collectors,
  });

  const done = () => {
    onRefused(null);
    void client.invalidateQueries({ queryKey: ['bo', 'collectors'] });
  };
  const failed = (err: unknown) => onRefused(err);

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
      setRequestId(uuid());
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
    if (creating) setRequestId(uuid());
    setCreating(!creating);
  };

  if (error) return <LoadFailed error={error} />;
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
      <div className="mb-3 flex justify-end">
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
                <tr className="border-b border-[var(--border)] transition-colors duration-150 ease-[var(--ease)] hover:bg-[var(--muted)]">
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
                    <Pill tone={c.exam_result === 'pass' ? 'live' : c.exam_result === 'fail' ? 'stopped' : 'waiting'}>
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
                      <Pill tone="stopped">{t('bo.collector.payout.none')}</Pill>
                    ) : (
                      <>
                        <Pill tone={c.payout_account.verify_status === 'verified' ? 'live' : 'waiting'}>
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
  const [id] = useState(() => uuid());

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

function Devices({ onRefused }: { onRefused: (error: unknown) => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(() => uuid());

  const devices = useQuery({ queryKey: ['bo', 'devices'], queryFn: backOffice.devices });
  /** Binding needs the roll of collectors; the same list the other tab reads. */
  const collectors = useQuery({ queryKey: ['bo', 'collectors'], queryFn: backOffice.collectors });

  const done = () => {
    onRefused(null);
    void client.invalidateQueries({ queryKey: ['bo', 'devices'] });
  };
  const failed = (err: unknown) => onRefused(err);

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
      setRequestId(uuid());
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
    if (creating) setRequestId(uuid());
    setCreating(!creating);
  };

  if (devices.error) return <LoadFailed error={devices.error} />;
  if (devices.isPending) return <TableSkeleton />;

  const rows = devices.data?.devices ?? [];
  const types = devices.data?.device_types ?? [];
  const roll = collectors.data?.collectors ?? [];

  return (
    <>
      <div className="mb-3 flex justify-end">
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
          <Problem title={t('bo.loadFailed')} body={t('bo.device.rollFailed')} reference={collectors.error instanceof ApiError ? collectors.error.ref : undefined} />
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
              <tr className="border-b border-[var(--border)] transition-colors duration-150 ease-[var(--ease)] hover:bg-[var(--muted)]">
                <Td className="num font-semibold">{d.hardware_serial}</Td>
                <Td className="text-[var(--muted-foreground)]">{d.device_type_code ?? '—'}</Td>
                <Td className="num">{d.firmware_version ?? '—'}</Td>
                <Td>
                  <Pill tone={d.status === 'active' ? 'live' : d.status === 'faulty' ? 'stopped' : 'waiting'}>
                    {t(`bo.device.state.${d.status}`)}
                  </Pill>
                  {d.fault_note ? (
                    <span className="ml-2 text-[0.8125rem] text-[var(--muted-foreground)]">{d.fault_note}</span>
                  ) : null}
                </Td>
                <Td className="num">
                  {d.bound_collector_ref ?? (
                    <span className="font-sans text-[var(--muted-foreground)]">{t('bo.device.unbound')}</span>
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

/**
 * A table on paper.
 *
 * Not a card: three tables that each sit in their own rounded, shadowed
 * container is the dashboard-of-panels this console refuses, and a shadow
 * under a table adds nothing an operator scanning a column can use. The
 * structure is hairlines — one strong rule under the head, one hairline
 * between rows — on the page's own white. The table still scrolls inside its
 * own container so the page never scrolls sideways.
 */
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="border-b border-[var(--foreground)]">
            {head.map((label, i) => (
              <th
                key={`${label}-${i}`}
                className="px-3 pb-2 text-[0.8125rem] font-semibold text-[var(--muted-foreground)]"
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

/** A row and the editor that opens under it, which `<tbody>` needs as siblings. */
function Rows({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function EditRow({ span, children }: { span: number; children: React.ReactNode }) {
  return (
    <tr className="border-b border-[var(--border)] bg-[var(--muted)]">
      <td colSpan={span} className="px-3 py-4">
        {children}
      </td>
    </tr>
  );
}

function Td({ className, children }: { className?: string; children: React.ReactNode }) {
  return <td className={cn('px-3 py-2.5 text-[0.875rem]', className)}>{children}</td>;
}

/**
 * A lifecycle state, as a pill with its own glyph.
 *
 * It used to be drawn in the three verdict hues, and that was wrong twice
 * over. `--pass` / `--partial` / `--reject` belong to §6.9's three review
 * outcomes and to nothing else — a published task rendered in the same green
 * as a passed episode teaches an operator that green means "good" everywhere,
 * on a console where one of those greens decides whether somebody is paid.
 * And the payout column here is a *payment-status label*, which the palette
 * bars from the brand ramps for the same reason.
 *
 * So these three climb in weight rather than hue — inverted ink, then the
 * page's own muted fill, then an outline — and each carries a distinct shape:
 * a filled disc, a half-filled disc, a bar. The axis reads with no colour at
 * all, which is what a printed roster or a colour-blind operator gets.
 */
type Tone = 'live' | 'waiting' | 'stopped';

const TONE_STYLE: Record<Tone, string> = {
  live: 'bg-[var(--foreground)] text-[var(--background)]',
  waiting: 'bg-[var(--muted)] text-[var(--muted-foreground)]',
  stopped: 'border border-[var(--border-strong)] bg-[var(--card)] text-[var(--foreground)]',
};

function ToneGlyph({ tone }: { tone: Tone }) {
  if (tone === 'stopped') {
    return <span aria-hidden="true" className="h-[2px] w-2.5 rounded-full bg-current" />;
  }
  return (
    <span
      aria-hidden="true"
      className="relative h-2.5 w-2.5 overflow-hidden rounded-full border border-current"
    >
      <span
        className={cn('absolute inset-y-0 left-0 bg-current', tone === 'live' ? 'right-0' : 'right-1/2')}
      />
    </span>
  );
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[0.75rem] font-semibold',
        TONE_STYLE[tone],
      )}
    >
      <ToneGlyph tone={tone} />
      {children}
    </span>
  );
}

const FIELD_LABEL =
  'text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]';
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

function LoadFailed({ error }: { error: unknown }) {
  const { t } = useTranslation();
  return <Problem title={t('bo.loadFailed')} body={t('bo.loadFailed.body')} reference={error instanceof ApiError ? error.ref : undefined} />;
}
