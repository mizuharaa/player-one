/**
 * One decision per step, a rail that says where you are, and a summary that
 * shows every answer before anything is written.
 *
 * The shape is Mercury's: a rail on the left reading "3 / 7" with the steps
 * named and glyphed, the current one lit, and one question on the right.
 * Airwallex's contribution is the nesting — steps belong to a named group and
 * a group ticks when all of its steps are answered, which is what stops a
 * seven-item rail reading as seven unrelated errands. Deputy's is the floor:
 * a Back and a Next, and nothing else competing with them. The last step is
 * Airtasker's — every answer listed, every row editable through the chevron
 * that took you there, and then one commit button.
 *
 * Two rules this component enforces for its callers, because both flows behind
 * it write rows somebody is paid on.
 *
 * **It never decides whether an answer is allowed.** `answered` is "has this
 * question been answered at all", not "is the answer acceptable" — the server
 * owns that, the same way the back-office tables do, and a Next button greyed
 * out on the client's reading of a rule is the copy of the rule that goes
 * stale. What it does refuse is an empty answer, because an unanswered
 * question is not a refusal from anywhere, it is a form nobody filled in.
 *
 * **Nothing is written until the summary.** Every step before it is local
 * state, so an operator can walk back and forth with a collector at the
 * counter and the database sees one commit at the end. That is also what makes
 * the summary honest: it is the request, not a picture of one.
 *
 * Keyboard: the rail is a list of real buttons, the pane's heading takes focus
 * when the step changes so a screen reader announces the new question rather
 * than leaving the caret on a Next button that has moved, and Back/Next/Commit
 * are ordinary buttons in document order. The whole flow completes with Tab,
 * Space and Enter and no pointer.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../ui/button.tsx';
import { Problem } from '../ui/primitives.tsx';
import { cn } from '../../lib/cn.ts';
import { ApiError } from '../../lib/api.ts';
import { refusalKey } from '../../routes/refusal.ts';
import { IconArrow, IconChevron, IconTick } from '../icons.tsx';

export type WizardStep = {
  /** Stable, and used as the React key and the rail's anchor. */
  id: string;
  /** The group this step sits under in the rail. An i18n key. */
  group: string;
  /** The step's name in the rail. An i18n key. */
  name: string;
  /** The one question, as a sentence. An i18n key. */
  question: string;
  /** A line under the question saying what the answer decides. An i18n key. */
  note?: string;
  Icon: (p: { size?: number }) => ReactNode;
  /** Whether the question has an answer. Not whether the answer is acceptable. */
  answered: boolean;
  /** The controls that answer it. */
  pane: ReactNode;
  /** What the summary prints for this step. */
  summary: ReactNode;
};

export function Wizard({
  steps,
  title,
  intro,
  commitLabel,
  committing,
  onCommit,
  /** A refusal or a failure, rendered above the pane on every step. */
  problem,
  /** Shown instead of the wizard once the commit has landed. */
  done,
  /**
   * Which step to open on. Zero everywhere except when a flow re-enters itself
   * — a second recording on a card whose handover is already on the record
   * starts at the first question that is still open, not back at the collector
   * it has already written down.
   */
  startAt = 0,
  /** A `[data-guide]` value for the rail, when the route this sits on has a tour. */
  guide,
}: {
  steps: WizardStep[];
  title: string;
  intro: string;
  commitLabel: string;
  committing: boolean;
  onCommit: () => void;
  problem?: ReactNode;
  done?: ReactNode;
  startAt?: number;
  guide?: string;
}) {
  const { t } = useTranslation();
  const [at, setAt] = useState(startAt);
  const heading = useRef<HTMLHeadingElement>(null);
  /**
   * The heading takes focus when the step CHANGES, and never on mount.
   *
   * Focusing on mount steals the caret from wherever the operator arrived
   * from; focusing on a change is what makes Next announce the new question
   * instead of leaving a screen reader on a button that has moved.
   *
   * It compares the step it last ran on rather than carrying a "have I
   * mounted" flag, and that is the difference between working and not:
   * StrictMode runs an effect, tears it down and runs it again on the same
   * render, so a boolean flag is already `true` the second time and the
   * heading takes a focus ring the instant the screen opens.
   */
  const shown = useRef(at);
  useEffect(() => {
    if (shown.current !== at) heading.current?.focus();
    shown.current = at;
  }, [at]);

  if (done !== undefined) return <>{done}</>;

  /** The summary is one past the last question, so it is a step and numbered as one. */
  const total = steps.length + 1;
  const onSummary = at === steps.length;
  const step = steps[at];
  const unanswered = steps.filter((s) => !s.answered);

  /** A group is ticked when every step in it is answered. Airwallex's nesting. */
  const groups: { key: string; steps: { step: WizardStep; index: number }[] }[] = [];
  steps.forEach((s, index) => {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.key === s.group) last.steps.push({ step: s, index });
    else groups.push({ key: s.group, steps: [{ step: s, index }] });
  });

  return (
    <div className="flex max-w-[62rem] flex-col gap-8 lg:flex-row lg:gap-12">
      {/*
        The rail. It is navigation and it is a progress report, and it is one
        element rather than two because a progress bar over a step list says
        the same thing twice in two shapes that can disagree.
      */}
      <nav data-guide={guide} aria-label={title} className="shrink-0 lg:w-[15.5rem]">
        <p className="num text-[0.8125rem] font-semibold text-[var(--muted-foreground)]">
          {t('wiz.step')} {at + 1} / {total}
        </p>
        <ol className="mt-4 space-y-5">
          {groups.map((group) => {
            const complete = group.steps.every(({ step: s }) => s.answered);
            return (
              <li key={group.key}>
                <p className="flex items-center gap-1.5 text-[0.75rem] font-bold uppercase tracking-[0.07em] text-[var(--muted-foreground)]">
                  {/* `--lime-ink`, which is lime-700 on the light page and
                      lime-200 on the dark one. `--lime-700` hard-coded would be
                      about 2.2:1 against the dark ground. */}
                  {complete ? <IconTick size={13} className="text-[var(--lime-ink)]" /> : null}
                  {t(group.key)}
                </p>
                <ol className="mt-1.5 space-y-0.5">
                  {group.steps.map(({ step: s, index }) => (
                    <RailStep
                      key={s.id}
                      step={s}
                      here={index === at}
                      /* Walking back is always allowed; walking forward past an
                         unanswered question is not, because the summary would
                         then be a picture of a request that cannot be sent. */
                      reachable={index <= at || steps.slice(0, index).every((p) => p.answered)}
                      onGo={() => setAt(index)}
                    />
                  ))}
                </ol>
              </li>
            );
          })}
          {/* `RailStep` is its own `<li>`; wrapping it in a second one made
              the summary entry a list item inside a list item. */}
          <RailStep
            step={{
              id: 'summary',
              group: '',
              name: 'wiz.review',
              question: 'wiz.review',
              Icon: IconTick,
              answered: unanswered.length === 0,
              pane: null,
              summary: null,
            }}
            here={onSummary}
            reachable={unanswered.length === 0}
            onGo={() => setAt(steps.length)}
          />
        </ol>
      </nav>

      <div className="min-w-0 flex-1">
        <p className="text-[0.875rem] font-semibold text-[var(--muted-foreground)]">{title}</p>

        {problem !== undefined ? <div className="mt-4">{problem}</div> : null}

        {onSummary ? (
          <>
            <h2
              ref={heading}
              tabIndex={-1}
              className="mt-1 max-w-[24ch] text-[2rem] font-extrabold leading-[1.1] tracking-[-0.03em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]"
            >
              {t('wiz.review.question')}
            </h2>
            <p className="mt-3 max-w-[62ch] text-[0.9375rem] leading-relaxed text-[var(--muted-foreground)]">
              {intro}
            </p>

            {/*
              Every answer, every one of them editable through the chevron that
              takes you back to the question that set it. A read-only summary
              makes a correction a walk backwards through six steps, which is
              how an operator with a collector waiting learns to commit and fix
              it afterwards — and on this lane there is no afterwards.
            */}
            <dl className="mt-8 max-w-[42rem] border-t border-[var(--border)]">
              {steps.map((s, index) => (
                <div key={s.id} className="border-b border-[var(--border)]">
                  <button
                    type="button"
                    onClick={() => setAt(index)}
                    className={cn(
                      'group flex w-full items-center gap-4 py-3.5 text-left',
                      'transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]',
                      'hover:bg-[var(--muted)]',
                    )}
                  >
                    <dt className="w-[11rem] shrink-0 text-[0.8125rem] font-semibold text-[var(--muted-foreground)]">
                      {t(s.name)}
                    </dt>
                    <dd className="min-w-0 flex-1 text-[0.9375rem] font-medium">
                      {s.answered ? (
                        s.summary
                      ) : (
                        <span className="text-[var(--warn)]">{t('wiz.unanswered')}</span>
                      )}
                    </dd>
                    <span className="flex shrink-0 items-center gap-1 text-[0.8125rem] font-semibold text-[var(--muted-foreground)] group-hover:text-[var(--foreground)]">
                      {t('wiz.edit')}
                      <IconChevron size={15} className="-rotate-90" />
                    </span>
                  </button>
                </div>
              ))}
            </dl>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={() => setAt(steps.length - 1)}>
                {t('wiz.back')}
              </Button>
              <Button
                variant="primary"
                size="lg"
                disabled={committing || unanswered.length > 0}
                onClick={onCommit}
              >
                {committing ? t('bo.working') : commitLabel}
              </Button>
            </div>
          </>
        ) : step !== undefined ? (
          <>
            <h2
              ref={heading}
              tabIndex={-1}
              className="mt-1 max-w-[24ch] text-[2rem] font-extrabold leading-[1.1] tracking-[-0.03em] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[var(--ring)]"
            >
              {t(step.question)}
            </h2>
            {step.note !== undefined ? (
              <p className="mt-3 max-w-[62ch] text-[0.9375rem] leading-relaxed text-[var(--muted-foreground)]">
                {t(step.note)}
              </p>
            ) : null}

            <div className="mt-8 max-w-[42rem]">{step.pane}</div>

            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button variant="outline" disabled={at === 0} onClick={() => setAt(at - 1)}>
                {t('wiz.back')}
              </Button>
              <Button variant="primary" disabled={!step.answered} onClick={() => setAt(at + 1)}>
                {t('wiz.next')}
                <IconArrow size={17} />
              </Button>
              {step.answered ? null : (
                <p className="text-[0.8125rem] text-[var(--muted-foreground)]">
                  {t('wiz.needAnswer')}
                </p>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One line in the rail.
 *
 * The current step is the only lime moment on the screen — the world allows
 * one, and a rail that says where you are is the thing worth spending it on.
 * Everything else is weight: answered steps carry a tick and full ink, steps
 * ahead are muted, and a step that cannot be reached yet is disabled rather
 * than hidden, because a rail whose length changes as you fill it in is a rail
 * that cannot be counted at a glance.
 */
function RailStep({
  step,
  here,
  reachable,
  onGo,
}: {
  step: WizardStep;
  here: boolean;
  reachable: boolean;
  onGo: () => void;
}) {
  const { t } = useTranslation();
  const { Icon } = step;
  return (
    <li>
      <button
        type="button"
        disabled={!reachable}
        aria-current={here ? 'step' : undefined}
        onClick={onGo}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-[var(--radius-base)] px-2.5 py-1.5 text-left text-[0.9375rem]',
          'transition-colors duration-[var(--duration-fast)] ease-[var(--ease)]',
          'disabled:pointer-events-none disabled:opacity-45',
          /*
           * `--stage` on the lime fill, not `--lime-ink`.
           *
           * `--lime-ink` is the label for something sitting on a lime TINT, and
           * it moves with the scheme — `#DFF7A6` in dark, which on the
           * `lime-500` fill is about 1.3:1 and unreadable. `lime-500` is a fill
           * under ink, and `--stage` is the ink that does not move, so the pair
           * holds in both schemes. `Pipeline.tsx` makes the same pairing and
           * `contrast.test.ts` is where the number lives.
           */
          here
            ? 'bg-[var(--lime-500)] font-bold text-[var(--stage)]'
            : 'font-medium text-[var(--muted-foreground)] hover:bg-[var(--muted)] hover:text-[var(--foreground)]',
        )}
      >
        <span
          className={cn(
            'grid h-6 w-6 shrink-0 place-items-center rounded-full',
            here
              ? 'text-[var(--stage)]'
              : step.answered
                ? 'bg-[var(--foreground)] text-[var(--background)]'
                : 'border border-[var(--border-strong)]',
          )}
        >
          {step.answered && !here ? <IconTick size={14} /> : <Icon size={15} />}
        </span>
        <span className="min-w-0 flex-1 truncate">{t(step.name)}</span>
      </button>
    </li>
  );
}

/* -------------------------------------------------------------------------
   The controls a step's pane is built from. They are here rather than in
   `ui/` because they are the wizard's own grammar: one question filling the
   pane, at a size somebody reads standing up at a counter.
   ---------------------------------------------------------------------- */

/**
 * A choice from a list that came off the server: a collector, a device, a
 * task, a scenario.
 *
 * A radio list and not a `<select>`. The list is the question here — the
 * operator is looking for the person standing in front of them — and a closed
 * dropdown answers a question nobody can see. Each option carries the one
 * identifier the operator can check against something physical: an external
 * reference, a hardware serial, a card label.
 */
export function ChoiceList<T>({
  name,
  items,
  value,
  onChange,
  idOf,
  render,
  empty,
}: {
  name: string;
  items: T[];
  value: string | null;
  onChange: (id: string) => void;
  idOf: (item: T) => string;
  render: (item: T) => { title: ReactNode; detail?: ReactNode };
  empty: ReactNode;
}) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <div role="radiogroup" aria-label={name} className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => {
        const id = idOf(item);
        const { title, detail } = render(item);
        const chosen = id === value;
        return (
          <label
            key={id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-[var(--radius-base)] border p-3.5',
              'transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease)]',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)]',
              chosen
                ? 'border-[var(--foreground)] bg-[var(--card)]'
                : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--muted)]',
            )}
          >
            <input
              type="radio"
              name={name}
              value={id}
              checked={chosen}
              onChange={() => onChange(id)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--foreground)]"
            />
            <span className="min-w-0">
              <span className="num block text-[0.9375rem] font-semibold">{title}</span>
              {detail !== undefined ? (
                <span className="mt-0.5 block text-[0.8125rem] text-[var(--muted-foreground)]">
                  {detail}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** The same list, when more than one may be chosen. */
export function CheckList<T>({
  name,
  items,
  values,
  onToggle,
  idOf,
  render,
  empty,
}: {
  name: string;
  items: T[];
  values: ReadonlySet<string>;
  onToggle: (id: string) => void;
  idOf: (item: T) => string;
  render: (item: T) => { title: ReactNode; detail?: ReactNode };
  empty: ReactNode;
}) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <div role="group" aria-label={name} className="grid gap-2 sm:grid-cols-2">
      {items.map((item) => {
        const id = idOf(item);
        const { title, detail } = render(item);
        const chosen = values.has(id);
        return (
          <label
            key={id}
            className={cn(
              'flex cursor-pointer items-start gap-3 rounded-[var(--radius-base)] border p-3.5',
              'transition-[background-color,border-color] duration-[var(--duration-fast)] ease-[var(--ease)]',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)]',
              chosen
                ? 'border-[var(--foreground)] bg-[var(--card)]'
                : 'border-[var(--border)] hover:border-[var(--border-strong)] hover:bg-[var(--muted)]',
            )}
          >
            <input
              type="checkbox"
              name={name}
              value={id}
              checked={chosen}
              onChange={() => onToggle(id)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--foreground)]"
            />
            <span className="min-w-0">
              <span className="num block text-[0.9375rem] font-semibold">{title}</span>
              {detail !== undefined ? (
                <span className="mt-0.5 block text-[0.8125rem] text-[var(--muted-foreground)]">
                  {detail}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </div>
  );
}

/**
 * A yes-or-no that is neither by default.
 *
 * APP-17b's two declarations are `z.boolean()` at the server and NOT NULL in
 * the column, deliberately without a default: "no" is a real answer and
 * "nobody asked" is not. So there is no pre-selected option here — the step is
 * unanswered until somebody says which, and the wizard will not walk past it.
 */
export function YesNo({
  name,
  label,
  value,
  onChange,
}: {
  name: string;
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <fieldset>
      <legend className="text-[1.0625rem] font-semibold">{label}</legend>
      <div className="mt-3 flex gap-2">
        {[true, false].map((option) => (
          <label
            key={String(option)}
            className={cn(
              'cursor-pointer rounded-[var(--radius-pill)] border px-5 py-2 text-[0.9375rem] font-semibold',
              'transition-[background-color,border-color,color] duration-[var(--duration-fast)] ease-[var(--ease)]',
              'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-[var(--ring)]',
              value === option
                ? 'border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]'
                : 'border-[var(--border-strong)] hover:bg-[var(--muted)]',
            )}
          >
            <input
              type="radio"
              name={name}
              checked={value === option}
              onChange={() => onChange(option)}
              className="sr-only"
            />
            {option ? t('counter.declare.yes') : t('counter.declare.no')}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** A labelled input, at the size the pane's one question deserves. */
export function WizField({
  label,
  hint,
  ...rest
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
        {label}
      </span>
      <input
        {...rest}
        className="num mt-1.5 h-12 w-full rounded-[var(--radius-base)] border border-[var(--field-border)] bg-[var(--card)] px-3.5 text-[1.0625rem]"
      />
      {hint !== undefined ? (
        <span className="mt-1.5 block text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">
          {hint}
        </span>
      ) : null}
    </label>
  );
}

/**
 * What the server said, as a sentence, with its reference when it carried one.
 *
 * This project refuses rather than guessing on the money path, and a wizard
 * that swallows a refusal is worse than no wizard: the operator commits again,
 * meets the same silence, and eventually writes the card off. So every shape a
 * refusal arrives in gets a sentence here.
 *
 * The shapes, and they are not one shape:
 *
 * - a **409 naming a `constraint`** — the back office's and the counter's
 *   common form. The catalogue turns the name into a sentence in the reader's
 *   language, and a name it has none for falls through to the generic line.
 * - a **409 named `unresolved_reference`** — `POST /handovers` only. It carries
 *   no constraint; it says which of the collector and the device the server
 *   could not find, which is the whole of what the operator has to fix.
 * - a **404** — the row a later request names is not there, which at this
 *   counter means the handover or the device went while the wizard was open.
 * - a **400** — the server would not parse an answer. That is this console's
 *   bug rather than the operator's, and it says so instead of blaming them.
 * - a **401 or 403** without a constraint — the session is gone or was never
 *   allowed to ask.
 */
export function Refusal({ error, onDismiss }: { error: unknown; onDismiss?: () => void }) {
  const { t } = useTranslation();
  const api = error instanceof ApiError ? error : undefined;
  const body = api?.body as { error?: string; collector?: string; device?: string } | undefined;

  const sentence = (): string => {
    if (api === undefined) return t('bo.loadFailed.body');
    if (body?.error === 'unresolved_reference') {
      const missing = [
        body.collector === 'unknown' ? t('counter.step.collector') : null,
        body.device === 'unknown' ? t('counter.step.device') : null,
      ].filter((x): x is string => x !== null);
      return `${t('counter.refused.reference')} ${missing.join(', ')}`;
    }
    if (api.constraint !== undefined) return t(refusalKey(api));
    if (api.status === 404) return t('wiz.failed.gone');
    if (api.status === 400) return t('wiz.failed.body');
    if (api.status === 401 || api.status === 403) return t('wiz.failed.session');
    return t('bo.loadFailed.body');
  };

  return (
    <Problem
      title={t('bo.refused')}
      body={sentence()}
      reference={api?.ref}
      action={
        onDismiss === undefined ? undefined : (
          <Button variant="outline" size="sm" onClick={onDismiss}>
            {t('bo.cancel')}
          </Button>
        )
      }
    />
  );
}
