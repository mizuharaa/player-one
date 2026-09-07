/**
 * The counter: a collector arrives with a TF card, and this is where it is
 * written down (BO-10).
 *
 * **This is an operator's screen on a fixed machine at a staffed counter.** It
 * is not a phone flow and there is no collector-facing version of it: the
 * import runs on the centre's own hardware, the card reader is on that desk,
 * and the person driving this is the clerk, with the collector standing on the
 * other side of the counter. What the flow borrows from a mobile onboarding is
 * only its *shape* — one decision per step, a rail that says where you are, a
 * summary of everything before the commit.
 *
 * **The steps are derived from what the two endpoints accept, and from nothing
 * else.** `POST /handovers` takes a collector, a device, a card label and the
 * moment it was handed over; `POST /handovers/:id/sessions` takes a task, a
 * scenario, a prepare time and the two APP-17b declarations. Three questions
 * about the card, three about the recording, and a summary. Anything not in
 * those two bodies is not a step: the centre, the operator and the machine come
 * off the tokens and are never asked for, and a collection point has a column
 * but no list route to choose one from, so that field is left unset rather than
 * typed as a uuid by a person.
 *
 * Three decisions this screen is built on, all of them recorded in `CLAUDE.md`
 * and none of them re-argued here:
 *
 * - **Session creation is split.** The app binds a session before recording
 *   (APP-16); the operator creates the handover when the card arrives (BO-10).
 *   In the pilot the operator also creates the session, and the server stamps
 *   it `session_origin = 'handover'` so the drift is measurable. The wizard
 *   does not send an origin and cannot.
 * - **There is no `session_ended_at`.** An operator cannot supply a truthful
 *   end, and a retroactively typed end that decides payment attribution is the
 *   failure the brief warns about. No field here asks for one.
 * - **Auto time-matching applies only to `session_origin = 'app'`.** Everything
 *   this screen writes is handover-origin, so its attribution goes to an
 *   operator to confirm rather than being matched against a microsecond PTS
 *   start. The screen says so, and points at where that confirmation happens.
 *
 * And the rule that survives everything: **no TF card is cleared**. Nothing on
 * this path deletes source media, and the last thing the screen says is that
 * the card in the operator's hand is still the card.
 */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button } from '../components/ui/button.tsx';
import { Panel, Problem, Skeleton } from '../components/ui/primitives.tsx';
import {
  ChoiceList,
  Refusal,
  Wizard,
  WizField,
  YesNo,
  type WizardStep,
} from '../components/wizard/Wizard.tsx';
import {
  IconCamera,
  IconCard,
  IconDeclare,
  IconPerson,
  IconScene,
  IconTask,
} from '../components/icons.tsx';
import { ApiError, counter, type Reference } from '../lib/api.ts';
import { localNow, stampLocal } from '../lib/format.ts';
import { uuid } from '../lib/uuid.ts';

export function CounterScreen() {
  const { t } = useTranslation();
  const reference = useQuery({ queryKey: ['counter', 'reference'], queryFn: counter.reference });

  if (reference.error) {
    return (
      <AppShell>
        <Header />
        <div className="mt-6">
          <Problem
            title={t('bo.loadFailed')}
            body={t('bo.loadFailed.body')}
            reference={reference.error instanceof ApiError ? reference.error.ref : undefined}
            action={
              <Button variant="outline" size="sm" onClick={() => void reference.refetch()}>
                {t('episodes.reload')}
              </Button>
            }
          />
        </div>
      </AppShell>
    );
  }

  if (reference.isPending || reference.data === null) {
    return (
      <AppShell>
        <Header />
        <Panel className="mt-6 p-4">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="mb-2 h-10 w-full last:mb-0" />
          ))}
        </Panel>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Header />
      <div className="mt-8">
        <Intake reference={reference.data} />
      </div>
    </AppShell>
  );
}

function Header() {
  const { t } = useTranslation();
  return (
    <header className="border-b border-[var(--foreground)] pb-5">
      <h1 className="text-[2.0625rem] font-extrabold leading-[1.12] tracking-[-0.03em]">
        {t('counter.title')}
      </h1>
      <p className="mt-3 max-w-[64ch] text-[1.0625rem] leading-relaxed text-[var(--muted-foreground)]">
        {t('counter.intro')}
      </p>
    </header>
  );
}

/** What was written, so the done panel can name it without re-reading anything. */
type Recorded = { card: string; collector: string; task: string };

function Intake({ reference }: { reference: Reference }) {
  const { t } = useTranslation();

  /**
   * The two ids this intake writes under, minted once and held.
   *
   * Both endpoints are idempotent on a client-generated id, which is the whole
   * of how a counter with the link down retries safely: a submit whose reply
   * was lost has to be retried under the SAME id, and a fresh one on the second
   * click is not a retry, it is a second handover for one card.
   */
  const [handoverId, setHandoverId] = useState(() => uuid());
  const [sessionId, setSessionId] = useState(() => uuid());

  /**
   * The handover row exists.
   *
   * This is the state that makes the difference between the two writes visible.
   * `POST /handovers` is `onConflictDoNothing` and does **not** compare the row
   * it found: sending the same id with a different collector answers
   * `{replayed: true}` and changes nothing, so a wizard that let the first
   * three answers be edited after the handover landed would show one collector
   * on screen and have written another. So once it has landed, those three
   * questions are on the record and are shown rather than asked. The way to
   * correct a wrong card is a new intake, not a second submit under an id the
   * database has already decided.
   */
  const [landed, setLanded] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<Recorded | null>(null);
  /** Bumped to re-enter the wizard for a second recording on the same card. */
  const [run, setRun] = useState(0);

  const [collectorId, setCollectorId] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [card, setCard] = useState('');
  const [handoverAt, setHandoverAt] = useState(localNow);

  const [taskId, setTaskId] = useState<string | null>(null);
  const [scenarioId, setScenarioId] = useState<string | null>(null);
  const [preparedAt, setPreparedAt] = useState(localNow);
  const [others, setOthers] = useState<boolean | null>(null);
  const [sensitive, setSensitive] = useState<boolean | null>(null);

  const collector = reference.collectors.find((c) => c.id === collectorId);
  const device = reference.devices.find((d) => d.id === deviceId);
  const task = reference.tasks.find((x) => x.id === taskId);
  const scenario = reference.scenarios.find((s) => s.id === scenarioId);

  /**
   * The two writes, in order, in one commit.
   *
   * The handover first, because the session hangs off it — and `landed` is set
   * between them rather than at the end, so a session the server refuses
   * leaves the screen telling the truth: the card is recorded, the recording on
   * it is not, and the next commit sends only what is still missing. The
   * handover POST replays harmlessly in that case, which is what its
   * idempotency is for.
   */
  const commit = useMutation({
    mutationFn: async () => {
      await counter.handover({
        id: handoverId,
        collector_id: collectorId!,
        device_id: deviceId!,
        tf_card_id: card.trim(),
        handover_time: new Date(handoverAt).toISOString(),
      });
      setLanded(true);
      await counter.session(handoverId, {
        id: sessionId,
        task_id: taskId!,
        scenario_id: scenarioId!,
        others_in_frame: others!,
        sensitive_info_present: sensitive!,
        prepare_time: new Date(preparedAt).toISOString(),
      });
    },
    onSuccess: () => {
      setError(null);
      setDone({
        card: card.trim(),
        collector: collector?.externalRef ?? '',
        task: task?.name ?? '',
      });
    },
    onError: setError,
  });

  /** A second recording on the card already on the desk: same handover, new session. */
  const anotherSession = () => {
    setSessionId(uuid());
    setTaskId(null);
    setScenarioId(null);
    setPreparedAt(localNow());
    setOthers(null);
    setSensitive(null);
    setDone(null);
    setError(null);
    setRun(run + 1);
  };

  /** A different collector at the counter: everything starts again. */
  const anotherCard = () => {
    setHandoverId(uuid());
    setSessionId(uuid());
    setLanded(false);
    setCollectorId(null);
    setDeviceId(null);
    setCard('');
    setHandoverAt(localNow());
    anotherSession();
  };

  const steps: WizardStep[] = [
    {
      id: 'collector',
      group: 'counter.group.card',
      name: 'counter.step.collector',
      question: 'counter.q.collector',
      note: 'counter.note.collector',
      Icon: IconPerson,
      answered: collectorId !== null,
      summary: collector?.externalRef ?? '',
      pane: landed ? (
        <Recorded value={collector?.externalRef ?? ''} />
      ) : (
        <ChoiceList
          name={t('counter.step.collector')}
          items={reference.collectors}
          value={collectorId}
          onChange={setCollectorId}
          idOf={(c) => c.id}
          render={(c) => ({
            title: c.externalRef,
            detail: `${t(`bo.collector.status.${c.status}`)} · ${
              c.examResult === null
                ? t('bo.collector.exam.none')
                : t(`bo.collector.exam.${c.examResult}`)
            }`,
          })}
          empty={<Nothing body={t('counter.empty.collectors')} />}
        />
      ),
    },
    {
      id: 'device',
      group: 'counter.group.card',
      name: 'counter.step.device',
      question: 'counter.q.device',
      note: 'counter.note.device',
      Icon: IconCamera,
      answered: deviceId !== null,
      summary: device?.hardwareSerial ?? '',
      pane: landed ? (
        <Recorded value={device?.hardwareSerial ?? ''} />
      ) : (
        <ChoiceList
          name={t('counter.step.device')}
          items={reference.devices}
          value={deviceId}
          onChange={setDeviceId}
          idOf={(d) => d.id}
          render={(d) => ({
            title: d.hardwareSerial,
            detail: `${t(`bo.device.state.${d.status}`)}${
              d.firmwareVersion === null ? '' : ` · ${d.firmwareVersion}`
            }`,
          })}
          empty={<Nothing body={t('counter.empty.devices')} />}
        />
      ),
    },
    {
      id: 'card',
      group: 'counter.group.card',
      name: 'counter.step.card',
      question: 'counter.q.card',
      note: 'counter.note.card',
      Icon: IconCard,
      answered: card.trim() !== '' && handoverAt !== '',
      summary: `${card.trim()} · ${stampLocal(new Date(handoverAt).toISOString())}`,
      pane: landed ? (
        <Recorded value={`${card.trim()} · ${stampLocal(new Date(handoverAt).toISOString())}`} />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <WizField
            label={t('counter.field.card')}
            value={card}
            onChange={(e) => setCard(e.target.value)}
            hint={t('counter.hint.card')}
            autoFocus
          />
          <WizField
            label={t('counter.field.handoverAt')}
            type="datetime-local"
            value={handoverAt}
            onChange={(e) => setHandoverAt(e.target.value)}
            hint={t('counter.hint.handoverAt')}
          />
        </div>
      ),
    },
    {
      id: 'task',
      group: 'counter.group.recording',
      name: 'counter.step.task',
      question: 'counter.q.task',
      note: 'counter.note.task',
      Icon: IconTask,
      answered: taskId !== null,
      summary: task?.name ?? '',
      pane: (
        <ChoiceList
          name={t('counter.step.task')}
          items={reference.tasks}
          value={taskId}
          onChange={setTaskId}
          idOf={(x) => x.id}
          render={(x) => ({
            title: x.name,
            /* The unit price as stored, never through Intl: this number
               multiplies into a payment and a rounded copy beside the exact
               one is how two figures start disagreeing. */
            detail: `${t(`bo.task.state.${x.status}`)} · ${x.unitPrice}`,
          })}
          empty={<Nothing body={t('counter.empty.tasks')} />}
        />
      ),
    },
    {
      id: 'scenario',
      group: 'counter.group.recording',
      name: 'counter.step.scenario',
      question: 'counter.q.scenario',
      note: 'counter.note.scenario',
      Icon: IconScene,
      answered: scenarioId !== null && preparedAt !== '',
      summary: `${scenario?.code ?? ''} · ${stampLocal(new Date(preparedAt).toISOString())}`,
      pane: (
        <div className="grid gap-6">
          <ChoiceList
            name={t('counter.step.scenario')}
            items={reference.scenarios}
            value={scenarioId}
            onChange={setScenarioId}
            idOf={(s) => s.id}
            render={(s) => ({
              title: s.code,
              detail: t(`counter.privacy.${s.privacyRiskLevel}`),
            })}
            empty={<Nothing body={t('counter.empty.scenarios')} />}
          />
          <div className="max-w-[22rem]">
            <WizField
              label={t('counter.field.preparedAt')}
              type="datetime-local"
              value={preparedAt}
              onChange={(e) => setPreparedAt(e.target.value)}
              hint={t('counter.hint.preparedAt')}
            />
          </div>
        </div>
      ),
    },
    {
      id: 'declare',
      group: 'counter.group.recording',
      name: 'counter.step.declare',
      question: 'counter.q.declare',
      note: 'counter.note.declare',
      Icon: IconDeclare,
      answered: others !== null && sensitive !== null,
      summary: `${t('counter.declare.others')}: ${answerOf(t, others)} · ${t(
        'counter.declare.sensitive',
      )}: ${answerOf(t, sensitive)}`,
      pane: (
        <div className="grid gap-7">
          <YesNo
            name="others_in_frame"
            label={t('counter.declare.others')}
            value={others}
            onChange={setOthers}
          />
          <YesNo
            name="sensitive_info_present"
            label={t('counter.declare.sensitive')}
            value={sensitive}
            onChange={setSensitive}
          />
        </div>
      ),
    },
  ];

  return (
    <Wizard
      key={run}
      guide="counter.plan"
      startAt={landed ? 3 : 0}
      steps={steps}
      title={t('counter.title')}
      intro={t('counter.review.intro')}
      commitLabel={landed ? t('counter.commit.session') : t('counter.commit')}
      committing={commit.isPending}
      onCommit={() => commit.mutate()}
      problem={
        error === null ? undefined : (
          <div className="grid gap-3">
            <Refusal error={error} onDismiss={() => setError(null)} />
            {landed ? (
              <p className="rounded-[var(--radius-base)] border border-[var(--warn)] bg-[var(--warn-bg)] px-4 py-3 text-[0.875rem] leading-relaxed">
                {t('counter.landed')}
              </p>
            ) : null}
          </div>
        )
      }
      done={
        done === null ? undefined : (
          <Done recorded={done} onAnotherSession={anotherSession} onAnotherCard={anotherCard} />
        )
      }
    />
  );
}

const answerOf = (t: (k: string) => string, value: boolean | null): string =>
  value === null ? t('wiz.unanswered') : value ? t('counter.declare.yes') : t('counter.declare.no');

/**
 * An answer that is already a row in the database.
 *
 * Shown rather than asked, because the id it was written under is decided and
 * re-sending it changes nothing. Saying that out loud is the difference between
 * a locked field and a broken one.
 */
function Recorded({ value }: { value: string }) {
  const { t } = useTranslation();
  return (
    <div className="rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--muted)] px-4 py-3.5">
      <p className="num text-[1.0625rem] font-semibold">{value}</p>
      <p className="mt-1.5 max-w-[58ch] text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
        {t('counter.recorded')}
      </p>
    </div>
  );
}

/**
 * A list the server sent back empty.
 *
 * On the hatch, like every other absence in this console: an empty list at a
 * counter can mean "there is nobody to choose" or "the reference sync failed",
 * and white space reads as the second. The sentence says which, and points at
 * the screen that fixes it.
 */
function Nothing({ body }: { body: string }) {
  const { t } = useTranslation();
  return (
    <div className="hatch rounded-[var(--radius-lg)] border border-[var(--border)] px-6 py-8">
      <p className="max-w-[54ch] text-[0.9375rem] leading-relaxed">{body}</p>
      <div className="mt-4">
        <Button asChild variant="secondary" size="sm">
          <Link to="/backoffice">{t('nav.backoffice')}</Link>
        </Button>
      </div>
    </div>
  );
}

/**
 * What was written, and the two things that are still true afterwards.
 *
 * The card is not cleared — that is Rule 6's undeviable half and no code path
 * on this lane touches source media. And the session was recorded at a counter,
 * so its attribution is not matched by time; an operator confirms it, which is
 * what `/episodes` is for. Both sentences are on the screen rather than in a
 * document because the operator holding the card is the person they are about.
 */
function Done({
  recorded,
  onAnotherSession,
  onAnotherCard,
}: {
  recorded: Recorded;
  onAnotherSession: () => void;
  onAnotherCard: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="max-w-[52rem]">
      <p className="text-[0.875rem] font-semibold text-[var(--muted-foreground)]">
        {t('counter.title')}
      </p>
      <h2 className="mt-1 text-[2rem] font-extrabold leading-[1.1] tracking-[-0.03em]">
        {t('counter.done.title')}
      </h2>

      <dl className="mt-6 border-t border-[var(--border)]">
        {[
          [t('counter.step.card'), recorded.card],
          [t('counter.step.collector'), recorded.collector],
          [t('counter.step.task'), recorded.task],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline gap-4 border-b border-[var(--border)] py-3"
          >
            <dt className="w-[11rem] shrink-0 text-[0.8125rem] font-semibold text-[var(--muted-foreground)]">
              {label}
            </dt>
            <dd className="num min-w-0 flex-1 text-[0.9375rem] font-medium">{value}</dd>
          </div>
        ))}
      </dl>

      <p className="mt-6 max-w-[64ch] text-[0.9375rem] leading-relaxed">{t('counter.done.card')}</p>
      <p className="mt-3 max-w-[64ch] text-[0.9375rem] leading-relaxed text-[var(--muted-foreground)]">
        {t('counter.done.match')}
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        <Button variant="primary" onClick={onAnotherCard}>
          {t('counter.done.nextCard')}
        </Button>
        <Button variant="outline" onClick={onAnotherSession}>
          {t('counter.done.nextSession')}
        </Button>
        <Button asChild variant="ghost">
          <Link to="/episodes">{t('nav.episodes')}</Link>
        </Button>
      </div>
    </div>
  );
}
