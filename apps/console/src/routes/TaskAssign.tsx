/**
 * Creating a task and putting people on it, as one flow (BO-01, BO-02, APP-10).
 *
 * The tasks tab is a table, and a table is the right shape for reading nine
 * tasks and publishing one. It is the wrong shape for the job this covers,
 * which is a sequence: a task has to exist before it can be published, be
 * published before anybody may claim it, and be claimed by somebody before a
 * camera going out with them means anything. That order is the server's, not a
 * preference — `task_claims_published_gate` refuses a claim on a draft — so the
 * flow that walks it is a wizard and the table stays exactly as it was.
 *
 * **Two objects, and the wizard keeps them apart.** A *claim* is APP-10: this
 * collector holds this task and is paid its unit price for what they record
 * against it. An *assignment* is custody: who held this camera from this
 * instant, which is what settlement reads to answer "who had it on 13 August".
 * They are different tables with different rules and the last step is optional
 * for exactly that reason — handing a camera out is a thing that often happens
 * at the counter later, and a flow that made it compulsory would teach an
 * operator to type something untrue to get past a step.
 *
 * **Every write after the task is reported on its own line.** One refused claim
 * must not lose the four that landed: the exam gate, the qualification gate,
 * the consent gate and the capacity cap are all per-collector, so each
 * collector gets its own attempt and its own sentence. The task itself is the
 * exception — if it cannot be created there is nothing to claim, and the flow
 * stops with the refusal on screen.
 */
import { useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button.tsx';
import { Problem } from '../components/ui/primitives.tsx';
import {
  CheckList,
  Refusal,
  Wizard,
  WizField,
  YesNo,
  type WizardStep,
} from '../components/wizard/Wizard.tsx';
import { IconCamera, IconChevron, IconPerson, IconTask } from '../components/icons.tsx';
import { ApiError, backOffice, type BoCollector, type BoDevice } from '../lib/api.ts';
import { refusalKey } from './refusal.ts';

/** One collector's two writes, and what the server said to each. */
type Outcome = {
  collector: string;
  claim: 'ok' | { key: string; ref: string | undefined };
  assignment: null | 'ok' | { key: string; ref: string | undefined };
};

type Result = { name: string; published: boolean; outcomes: Outcome[] };

export function TaskAssign({
  collectors,
  devices,
  onClose,
  onLanded,
}: {
  collectors: BoCollector[];
  devices: BoDevice[];
  onClose: () => void;
  /** The table behind this has to be re-read: a task and its claimants changed. */
  onLanded: () => void;
}) {
  const { t } = useTranslation();

  /**
   * Every id this flow will write under, minted once and kept.
   *
   * Same rule as everywhere else on this seam: a submit whose reply was lost is
   * retried under the same id, so the second click is a replay and not a second
   * task or a second claim. The per-collector ids are minted on demand and kept
   * in a ref, so ticking a collector, unticking it and ticking it again does
   * not mint a third id for one claim.
   */
  const [taskId] = useState(() => crypto.randomUUID());
  const ids = useRef(new Map<string, { claim: string; assignment: string }>());
  const idsFor = (collectorId: string) => {
    const held = ids.current.get(collectorId);
    if (held !== undefined) return held;
    const fresh = { claim: crypto.randomUUID(), assignment: crypto.randomUUID() };
    ids.current.set(collectorId, fresh);
    return fresh;
  };

  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [price, setPrice] = useState('');
  const [target, setTarget] = useState('');
  const [capacity, setCapacity] = useState('1');
  const [publish, setPublish] = useState<boolean | null>(null);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  /** collector id → device id. Absent means no camera goes out with them. */
  const [cameras, setCameras] = useState<Record<string, string>>({});

  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<Result | null>(null);

  const picked = collectors.filter((c) => chosen.has(c.id));

  const commit = useMutation({
    mutationFn: async (): Promise<Result> => {
      await backOffice.createTask({
        id: taskId,
        name: name.trim(),
        type: type.trim(),
        unit_price: price.trim(),
        ...(target.trim() === '' ? {} : { target_effective_duration_s: target.trim() }),
        max_concurrent_claimants: Number(capacity),
      });
      if (publish === true) await backOffice.setTaskStatus(taskId, 'published');

      /**
       * Sequential, not `Promise.all`.
       *
       * The capacity cap is decided by a trigger counting live claims, so five
       * claims sent at once against a task that allows three is a race the
       * database resolves correctly and the screen cannot narrate: two
       * collectors are refused and which two is arbitrary. One at a time makes
       * the refusal belong to the person it names, in the order the operator
       * chose them.
       */
      const outcomes: Outcome[] = [];
      for (const c of picked) {
        const mine = idsFor(c.id);
        const outcome: Outcome = { collector: c.external_ref, claim: 'ok', assignment: null };
        try {
          await backOffice.claimTask(taskId, { id: mine.claim, collector_id: c.id });
        } catch (err) {
          outcome.claim = said(err);
        }
        const deviceId = cameras[c.id];
        if (deviceId !== undefined && deviceId !== '') {
          try {
            await backOffice.assignDevice(deviceId, {
              id: mine.assignment,
              collector_id: c.id,
              valid_from: new Date().toISOString(),
            });
            outcome.assignment = 'ok';
          } catch (err) {
            outcome.assignment = said(err);
          }
        }
        outcomes.push(outcome);
      }
      return { name: name.trim(), published: publish === true, outcomes };
    },
    onSuccess: (landed) => {
      setError(null);
      setResult(landed);
      onLanded();
    },
    onError: setError,
  });

  const steps: WizardStep[] = [
    {
      id: 'name',
      group: 'assign.group.task',
      name: 'assign.step.name',
      question: 'assign.q.name',
      note: 'assign.note.name',
      Icon: IconTask,
      answered: name.trim() !== '' && type.trim() !== '',
      summary: `${name.trim()} · ${type.trim()}`,
      pane: (
        <div className="grid gap-5 sm:grid-cols-2">
          <WizField
            label={t('bo.task.name')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            autoFocus
          />
          <WizField
            label={t('bo.task.type')}
            value={type}
            onChange={(e) => setType(e.target.value)}
            hint={t('assign.hint.type')}
          />
        </div>
      ),
    },
    {
      id: 'rate',
      group: 'assign.group.task',
      name: 'assign.step.rate',
      question: 'assign.q.rate',
      note: 'assign.note.rate',
      Icon: IconTask,
      answered: price.trim() !== '',
      summary: `${price.trim()}${target.trim() === '' ? '' : ` · ${target.trim()}`}`,
      pane: (
        <div className="grid gap-5 sm:grid-cols-2">
          <WizField
            label={t('bo.task.rate')}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            pattern="\d{1,8}(\.\d{1,4})?"
            hint={t('bo.task.priceNote')}
            autoFocus
          />
          <WizField
            label={t('bo.task.target')}
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            inputMode="decimal"
            pattern="\d{1,12}(\.\d{1,6})?"
            hint={t('assign.hint.target')}
          />
        </div>
      ),
    },
    {
      id: 'capacity',
      group: 'assign.group.task',
      name: 'assign.step.capacity',
      question: 'assign.q.capacity',
      note: 'assign.note.capacity',
      Icon: IconTask,
      answered: capacity.trim() !== '' && Number(capacity) >= 1,
      summary: capacity.trim(),
      pane: (
        <div className="max-w-[18rem]">
          <WizField
            label={t('bo.task.maxClaimants')}
            type="number"
            min={1}
            max={2147483647}
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            autoFocus
          />
        </div>
      ),
    },
    {
      id: 'publish',
      group: 'assign.group.task',
      name: 'assign.step.publish',
      question: 'assign.q.publish',
      note: 'assign.note.publish',
      Icon: IconTask,
      answered: publish !== null,
      summary: publish === null ? '' : t(publish ? 'assign.publish.now' : 'assign.publish.draft'),
      pane: (
        <YesNo
          name="publish"
          label={t('assign.publish.label')}
          value={publish}
          onChange={setPublish}
        />
      ),
    },
    {
      id: 'claimants',
      group: 'assign.group.people',
      name: 'assign.step.claimants',
      question: 'assign.q.claimants',
      note: 'assign.note.claimants',
      Icon: IconPerson,
      /* Nobody is a real answer: a task can be published and left for the task
         hall to fill. The step is answered by having been visited, which is
         what the "assign to nobody" option below records. */
      answered: true,
      summary:
        picked.length === 0
          ? t('assign.claimants.none')
          : picked.map((c) => c.external_ref).join(', '),
      pane: (
        <CheckList
          name={t('assign.step.claimants')}
          items={collectors}
          values={chosen}
          onToggle={(id) => {
            const next = new Set(chosen);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setChosen(next);
          }}
          idOf={(c) => c.id}
          render={(c) => ({
            title: c.external_ref,
            detail: `${t(`bo.collector.status.${c.status}`)} · ${
              c.exam_result === null
                ? t('bo.collector.exam.none')
                : t(`bo.collector.exam.${c.exam_result}`)
            }`,
          })}
          empty={<p className="text-[0.9375rem]">{t('assign.claimants.empty')}</p>}
        />
      ),
    },
    {
      id: 'cameras',
      group: 'assign.group.people',
      name: 'assign.step.cameras',
      question: 'assign.q.cameras',
      note: 'assign.note.cameras',
      Icon: IconCamera,
      answered: true,
      summary: (() => {
        const handed = picked.filter((c) => (cameras[c.id] ?? '') !== '');
        if (handed.length === 0) return t('assign.cameras.none');
        return handed
          .map((c) => {
            const serial = devices.find((d) => d.id === cameras[c.id])?.hardware_serial ?? '';
            return `${c.external_ref} → ${serial}`;
          })
          .join(', ');
      })(),
      pane:
        picked.length === 0 ? (
          <p className="text-[0.9375rem] text-[var(--muted-foreground)]">
            {t('assign.cameras.noClaimants')}
          </p>
        ) : (
          <div className="grid gap-3">
            {picked.map((c) => (
              <label
                key={c.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-base)] border border-[var(--border)] px-4 py-3"
              >
                <span className="num text-[0.9375rem] font-semibold">{c.external_ref}</span>
                <select
                  className="h-10 rounded-[var(--radius-base)] border border-[var(--field-border)] bg-[var(--card)] px-3 text-[0.9375rem]"
                  value={cameras[c.id] ?? ''}
                  onChange={(e) => setCameras({ ...cameras, [c.id]: e.target.value })}
                >
                  <option value="">{t('assign.cameras.no')}</option>
                  {devices.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.hardware_serial}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ),
    },
  ];

  if (result !== null) {
    return <Landed result={result} onClose={onClose} />;
  }

  return (
    <div>
      {/* Left, over the rail, so leaving the wizard sits where the reader's eye
          starts rather than orphaned in the whitespace on the right. */}
      <div className="mb-5">
        <Button variant="ghost" size="sm" onClick={onClose}>
          <IconChevron size={15} className="rotate-90" />
          {t('bo.cancel')}
        </Button>
      </div>
      <Wizard
        steps={steps}
        title={t('assign.title')}
        intro={t('assign.review.intro')}
        commitLabel={t('assign.commit')}
        committing={commit.isPending}
        onCommit={() => commit.mutate()}
        problem={
          error === null ? undefined : <Refusal error={error} onDismiss={() => setError(null)} />
        }
      />
    </div>
  );
}

/** A refusal turned into the key and the reference the result list will print. */
function said(err: unknown): { key: string; ref: string | undefined } {
  return {
    key: refusalKey(err),
    ref: err instanceof ApiError ? err.ref : undefined,
  };
}

/**
 * What landed and what did not, one line per person.
 *
 * A summary that said "done" would be a lie on the common case: a collector
 * who has not passed the exam is refused by `task_claims_exam_gate` and the
 * other four claims land. The operator has to leave this screen knowing which
 * of the people in front of them holds the task.
 */
function Landed({ result, onClose }: { result: Result; onClose: () => void }) {
  const { t } = useTranslation();
  const refused = result.outcomes.some((o) => o.claim !== 'ok' || (o.assignment !== null && o.assignment !== 'ok'));

  return (
    <div className="max-w-[52rem]">
      <p className="text-[0.875rem] font-semibold text-[var(--muted-foreground)]">
        {t('assign.title')}
      </p>
      <h2 className="mt-1 text-[2rem] font-extrabold leading-[1.1] tracking-[-0.03em]">
        {t('assign.done.title')}
      </h2>
      <p className="num mt-3 text-[1.0625rem] font-semibold">{result.name}</p>
      <p className="mt-1 text-[0.9375rem] text-[var(--muted-foreground)]">
        {t(result.published ? 'assign.done.published' : 'assign.done.draft')}
      </p>

      {result.outcomes.length === 0 ? (
        <p className="mt-6 max-w-[62ch] text-[0.9375rem] leading-relaxed">
          {t('assign.done.nobody')}
        </p>
      ) : (
        <ul className="mt-7 border-t border-[var(--border)]">
          {result.outcomes.map((o) => (
            <li key={o.collector} className="border-b border-[var(--border)] py-3.5">
              <p className="num text-[0.9375rem] font-semibold">{o.collector}</p>
              <p
                className={
                  o.claim === 'ok'
                    ? 'mt-1 text-[0.875rem] text-[var(--muted-foreground)]'
                    : 'mt-1 text-[0.875rem] leading-relaxed text-[var(--foreground)]'
                }
              >
                {o.claim === 'ok' ? t('assign.done.claimed') : t(o.claim.key)}
                {o.claim !== 'ok' && o.claim.ref !== undefined ? (
                  <span className="ml-2 font-mono text-[0.75rem] select-all text-[var(--muted-foreground)]">
                    {t('bo.error.reference')} {o.claim.ref}
                  </span>
                ) : null}
              </p>
              {o.assignment === null ? null : (
                <p
                  className={
                    o.assignment === 'ok'
                      ? 'mt-1 text-[0.875rem] text-[var(--muted-foreground)]'
                      : 'mt-1 text-[0.875rem] leading-relaxed text-[var(--foreground)]'
                  }
                >
                  {o.assignment === 'ok' ? t('assign.done.assigned') : t(o.assignment.key)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      {refused ? (
        <div className="mt-6">
          <Problem title={t('bo.refused')} body={t('assign.done.someRefused')} />
        </div>
      ) : null}

      <div className="mt-8">
        <Button variant="primary" onClick={onClose}>
          {t('assign.done.close')}
        </Button>
      </div>
    </div>
  );
}
