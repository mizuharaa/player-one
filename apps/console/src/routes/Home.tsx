/**
 * Home: what the shift has done, and the one action worth taking.
 *
 * The composition refuses the dashboard default — a row of four identical stat
 * cards above a table. There is exactly one hero here, the gauge, because
 * there is exactly one number a reviewer is judged on, and the primary action
 * sits directly under it so the distance between "how am I doing" and "carry
 * on" is one glance and one key.
 *
 * **The figures are a ledger, not four cards.** Three measured quantities in
 * one panel, each sitting with the sentence that says what it is and what it
 * is not. A figure whose note is somewhere else is a figure somebody will
 * misread, and on this screen a misread figure is a person thinking they have
 * been paid.
 *
 * **One ink block, and it has to earn it.** `.feature-block` appears once per
 * screen and only where a figure carries its own sentence and its own action
 * — here the settled value, "Your decisions only. Not the programme's spend."
 * and the arrow to `/settle`. It is not the big-number-small-label template
 * with a dark background: take away either the sentence or the arrow and the
 * block should go back to being a row in the ledger above it.
 *
 * **The strip at the bottom is not a metric.** An unresolved episode is
 * somebody's unpaid recording sitting still, so it gets a sentence and a way
 * in rather than a number in a grid.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button, Key } from '../components/ui/button.tsx';
import { Panel, Problem, Skeleton, VerdictPill } from '../components/ui/primitives.tsx';
import { Panda } from '../components/identity/Panda.tsx';
import { mascotStateAt, type MascotState } from '@playerone/design/tokens';
import { IconAlert, IconArrow } from '../components/icons.tsx';
import { durationShort, money, pace, stampLocal } from '../lib/format.ts';
import { api, ApiError } from '../lib/api.ts';
import { defaultPeriod } from '../payout/period.ts';

/**
 * The four shift names, from the catalogue rather than from `MASCOT_LABEL`.
 *
 * The label map in `Panda.tsx` carries English and Chinese only, because it is
 * artwork metadata that also ships to React Native. This console is read in
 * Vietnamese too, and these four strings already exist in all three locales.
 */
const SHIFT_KEY: Record<MascotState, string> = {
  earlyBird: 'home.shiftEarly',
  dayShift: 'home.shiftDay',
  goldenHour: 'home.shiftGolden',
  nightOwl: 'home.shiftNight',
};

/** `19:42` on the clock of the machine that decided which shift this is. */
function localClock(): string {
  return new Date().toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

interface Shift {
  currency: string;
  reviewer: string;
  target: number;
  decided: number;
  approved: number;
  payable_seconds: string;
  median_seconds_to_verdict: string | null;
  settled_amount: string;
  queue_depth: number;
  session_average_seconds: number | null;
  needs_human: number;
}

export function HomeScreen() {
  const { t } = useTranslation();

  const { data, isPending, error } = useQuery<Shift>({
    queryKey: ['shift'],
    queryFn: async () => {
      const res = await fetch('/api/review/shift', { credentials: 'same-origin' });
      if (!res.ok) throw new ApiError(res.status, res.statusText);
      return (await res.json()) as Shift;
    },
    /** The shift figures move as the reviewer works; a minute is close enough. */
    refetchInterval: 60_000,
  });

  const state = mascotStateAt();
  const approvalRate =
    data && data.decided > 0 ? Math.round((data.approved / data.decided) * 100) : null;

  return (
    <AppShell
      queueDepth={data?.queue_depth}
      averageSeconds={data?.session_average_seconds}
      operator={data?.reviewer}
    >
      {error ? (
        <div className="mb-6">
          <Problem
            reference={error instanceof ApiError ? error.ref : undefined}
            title={t('ui.a.home.error.title')}
            body={t('ui.a.home.error.body')}
          />
        </div>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        {/* --- The gauge. The page's one hero. --- */}
        <div>
          <Panel data-guide="home.gauge" className="flex flex-col items-center px-6 pb-5 pt-6">
            {/*
              The page's `h1`, and it is the shift rather than the product
              name: the operator knows what they signed into, and a screen
              whose only heading is a logo gives a screen-reader user nothing
              to orient on. Sized as a caption because the gauge under it is
              the hero — heading level and visual weight are different axes.

              **The clock is printed next to the shift name.** "Golden hour" is
              decided by `getHours()` on the machine that renders this page,
              and PaXini's reviewers are an hour behind the counter in Ho Chi
              Minh City. A reviewer in Shenzhen reading "Golden hour" with no
              time beside it cannot tell whose evening it is; with the time
              there, they can. The value refreshes with the shift query, once a
              minute.
            */}
            <h1
              className="text-[0.875rem] font-semibold text-[var(--muted-foreground)]"
              title={t('ui.a.home.clock')}
            >
              {t('home.greeting')} · {t(SHIFT_KEY[state])} ·{' '}
              <span className="num">{localClock()}</span>
            </h1>

            {isPending ? (
              <Skeleton className="mt-4 h-[268px] w-[300px] rounded-full" />
            ) : (
              <Gauge value={data?.decided ?? 0} target={data?.target ?? 60} state={state} />
            )}
          </Panel>

          <Button
            asChild
            variant="primary"
            size="lg"
            data-guide="home.start"
            className="mt-3 w-full"
          >
            <Link to="/review">
              {t('home.start')}
              <Key>R</Key>
            </Link>
          </Button>
        </div>

        {/* --- The ledger, then the one ink block. --- */}
        <div className="flex flex-col gap-4">
          <Panel data-guide="home.figures" className="px-5 py-1.5">
            <dl className="m-0">
              <Figure
                label={t('home.payable')}
                value={isPending ? null : durationShort(data?.payable_seconds ?? '0')}
                note={t('ui.a.home.payable.note')}
              />
              <Figure
                label={t('home.approval')}
                value={isPending ? null : approvalRate === null ? '—' : `${approvalRate}%`}
                /*
                 * The note carries the programme's own number, because this is
                 * the only figure on the screen a reviewer can read as a grade
                 * and there is nothing on it to grade against. ≥85–90%
                 * qualification is the phase-1 target in PRODUCT.md; without
                 * it, 67% is either a disaster or a Tuesday and the screen does
                 * not say which. It is the *programme's* rate over 40,000
                 * hours, not a quota for one shift, and the sentence says so
                 * rather than turning a target into a score.
                 */
                note={`${t('ui.a.home.approval.note')} ${t('ui.a.home.approval.target')}`}
                /*
                 * The count, and not a verdict pill.
                 *
                 * It read as `good` above 85% and `partial` below it, which
                 * spent two of the three colours that decide whether one person
                 * is paid on an aggregate of everyone. A rate is not a verdict:
                 * there is no episode behind this pill to pass or fail, and a
                 * reviewer who learns that green-here means good has learned
                 * the wrong thing about green-there. The sentence under the
                 * figure carries the judgement instead.
                 */
                trailing={
                  approvalRate === null ? null : (
                    <span className="num rounded-full bg-[var(--muted)] px-2 py-0.5 text-[0.75rem] font-semibold text-[var(--muted-foreground)]">
                      {data?.approved ?? 0}/{data?.decided ?? 0}
                    </span>
                  )
                }
              />
              <Figure
                label={t('queue.average')}
                value={isPending ? null : pace(data?.session_average_seconds)}
                note={t('ui.a.home.pace.note')}
              />
            </dl>
          </Panel>

          <Settled
            amount={isPending ? null : money(data?.settled_amount, data?.currency ?? 'VND')}
          />
        </div>
      </div>

      {/* --- The strip that is not a metric. --- */}
      {data && data.needs_human > 0 ? (
        <Link
          to="/episodes"
          data-guide="home.needsHuman"
          className="group mt-6 flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-[var(--sun-300)] bg-[var(--sun-50)] px-5 py-4 no-underline transition-colors duration-150 ease-[var(--ease)] hover:border-[var(--sun-500)] hover:bg-[var(--sun-100)]"
        >
          <IconAlert size={20} className="shrink-0 text-[var(--sun-700)]" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.9375rem] font-bold text-[var(--sun-700)]">
              <span className="num">{data.needs_human}</span> {t('home.needsHuman')}
            </p>
            <p className="mt-0.5 text-[0.875rem] text-[var(--sun-700)]">
              {t('home.needsHuman.body')}
            </p>
          </div>
          <IconArrow
            size={18}
            className="shrink-0 text-[var(--sun-700)] transition-transform duration-150 ease-[var(--ease)] group-hover:translate-x-0.5"
          />
        </Link>
      ) : null}

      <RecentVerdicts currency={data?.currency ?? 'VND'} />
    </AppShell>
  );
}

/**
 * The settled value: the one ink block this screen is allowed.
 *
 * `.feature-block` is `--stage` — the console's single near-black, the same one
 * the top bar and the review theatre use — and the figure inside it is mono at
 * the display step. The sentence under it is not decoration: DESIGN.md pins it
 * because a personal figure read as the programme's budget is wrong by orders
 * of magnitude. The arrow is a real link to the screen that owns the money, so
 * the block is a door and not a poster.
 */
function Settled({ amount }: { amount: string | null }) {
  const { t } = useTranslation();
  return (
    <div data-guide="home.settled" className="feature-block relative px-6 py-6">
      <p className="text-[0.875rem] font-semibold text-[var(--stage-mid)]">{t('home.settled')}</p>
      {amount === null ? (
        <div className="mt-2 h-[2.75rem] w-40 animate-pulse rounded-[var(--radius-sm)] bg-white/10" />
      ) : (
        <p className="figure mt-1.5 pr-14 text-[var(--stage-fg)]">{amount}</p>
      )}
      <p className="mt-3 max-w-[38ch] text-[0.875rem] leading-relaxed text-[var(--stage-mid)]">
        {t('ui.a.home.settled.note')}
      </p>

      <Link
        to="/settle"
        search={{ period: defaultPeriod() }}
        aria-label={t('ui.a.home.settled.open')}
        title={t('ui.a.home.settled.open')}
        className={
          'absolute right-5 top-5 grid h-11 w-11 place-items-center rounded-full border ' +
          'border-[var(--stage-line)] bg-[var(--stage-panel)] text-[var(--stage-fg)] no-underline ' +
          'transition-[background-color,border-color,transform] duration-150 ease-[var(--ease)] ' +
          'hover:border-[var(--sun-500)] hover:bg-[var(--sun-500)] hover:text-[var(--stage)] ' +
          'active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--sun-400)]'
        }
      >
        <IconArrow size={19} />
      </Link>
    </div>
  );
}

/**
 * The last twenty verdicts this reviewer committed.
 *
 * Home without this is a page of aggregates, and an aggregate is exactly the
 * thing a reviewer cannot check. The individual rows are what let somebody
 * notice that the partial they marked at 11:04 paid less than they expected,
 * which is the first step of every payment dispute — so the row carries the
 * measured duration beside the effective one, and the amount beside both.
 */
function RecentVerdicts({ currency }: { currency: string }) {
  const { t } = useTranslation();
  const { data, isPending } = useQuery({
    queryKey: ['recent'],
    queryFn: () => api.recent(),
  });

  const reviews = data?.reviews ?? [];

  return (
    <section className="mt-6" data-guide="home.recent">
      <h2 className="text-[0.9375rem] font-bold tracking-[-0.01em]">{t('recent.title')}</h2>

      <Panel className="mt-2 overflow-hidden">
        {isPending ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : reviews.length === 0 ? (
          <div className="hatch flex items-center justify-center px-5 py-10">
            <p className="text-[0.9375rem] text-[var(--muted-foreground)]">{t('recent.empty')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] border-collapse text-left">
              {/*
                The header row this table went without.

                Four unlabelled columns of numbers is a table a reviewer has to
                decode from the values — and two of these columns are durations
                in the same format, so "which one is the measured one" was
                genuinely unanswerable from the screen. `2:12 → 2:12` is only
                obvious on a full pass. The arrow is inside the heading for the
                same reason it is inside the cell: the pair is one reading, not
                two columns that happen to be adjacent.
              */}
              <thead>
                <tr className="border-b border-[var(--border-strong)]">
                  <Th className="pl-5">{t('ui.a.home.recent.time')}</Th>
                  <Th>{t('ui.a.home.recent.episode')}</Th>
                  <Th>{t('ui.a.home.recent.verdict')}</Th>
                  <Th className="w-full">{t('ui.a.home.recent.duration')}</Th>
                  <Th align="right">{t('ui.a.home.recent.amount')}</Th>
                  <Th align="right" className="pr-5">
                    {t('ui.a.home.recent.pace')}
                  </Th>
                </tr>
              </thead>
              <tbody>
                {reviews.map((r) => {
                  const verdict =
                    r.reviewState === 'pass'
                      ? 'good'
                      : r.reviewState === 'partial_pass'
                        ? 'partial'
                        : 'bad';
                  return (
                    <tr
                      key={r.reviewId}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                    >
                      <td className="num py-2.5 pl-5 pr-3 text-[0.8125rem] whitespace-nowrap text-[var(--muted-foreground)]">
                        {stampLocal(r.reviewedAt)}
                      </td>
                      {/*
                        The episode this verdict was about.

                        A dispute starts with somebody naming one episode, and
                        until this column existed the screen could show that a
                        partial paid ₫1,582 without saying *which* recording
                        that was. The id is a uuid, so the cell prints the head
                        of it — enough to match against a row on `/episodes` or
                        a line on a bill — and carries the whole thing in
                        `title` for copying. It is text and not a link: this
                        console has no route for one episode, and a link that
                        goes to a list is a link that lied.
                      */}
                      <td
                        className="num px-3 py-2.5 text-[0.8125rem] text-[var(--muted-foreground)]"
                        title={r.episodeId}
                      >
                        {r.episodeId.slice(0, 8)}
                      </td>
                      <td className="px-3 py-2.5">
                        <VerdictPill verdict={verdict} size="sm">
                          {t(`verdict.${verdict}`)}
                        </VerdictPill>
                      </td>
                      <td className="num px-3 py-2.5 text-[0.8125rem] whitespace-nowrap text-[var(--muted-foreground)]">
                        {durationShort(r.measured)}
                        {' → '}
                        <span className="font-semibold text-[var(--foreground)]">
                          {durationShort(r.effective)}
                        </span>
                      </td>
                      <td className="num px-3 py-2.5 text-right text-[0.8125rem] font-semibold">
                        {money(r.amount, currency)}
                      </td>
                      <td className="num py-2.5 pl-3 pr-5 text-right text-[0.8125rem] text-[var(--muted-foreground)]">
                        {r.seconds === null ? '—' : pace(Number(r.seconds))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </section>
  );
}

/**
 * A column heading, in the register `/episodes` already uses for its tables —
 * 12px, semibold, tracked and upper case. Uppercase is not this world's habit
 * anywhere else; it is here because a header row has to read as a different
 * kind of thing from the twenty rows of data under it without a second rule or
 * a fill, and because the console's other table already made that choice.
 */
function Th({
  children,
  align = 'left',
  className,
}: {
  children: React.ReactNode;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th
      scope="col"
      className={
        'px-3 py-2 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)] ' +
        (align === 'right' ? 'text-right ' : 'text-left ') +
        (className ?? '')
      }
    >
      {children}
    </th>
  );
}

/**
 * The gauge: a 240° arc with Trúc standing in the middle of it.
 *
 * An arc rather than a bar because it holds the target and the current value in
 * one shape at a size worth looking at, and because a bar that reaches its end
 * has nowhere left to go — a reviewer past target should see that, not see a
 * full bar. The sweep is one of the console's two authored motions: 900ms,
 * once, on load.
 *
 * **Bamboo, and never mistakable for a verdict.** The fill is `bamboo-600`,
 * which is the stroke step (3.01:1 on the muted track, the exact pair the
 * contrast test pins). Bamboo is barred from verdicts and from money, and this
 * ring carries three things that keep it on the right side of that line: a gap
 * at the bottom, the count printed as text, and a caption naming the unit. Past
 * target the stroke moves to `--pass`, which is the one moment the two
 * vocabularies meet on purpose — and the caption still says what it counts.
 *
 * The panda is positioned over the arc rather than inside a `foreignObject`:
 * `PandaStage` mounts a WebGL canvas, and a canvas inside an SVG is a rendering
 * path nothing else in this console depends on.
 */
function Gauge({ value, target, state }: { value: number; target: number; state: MascotState }) {
  const { t } = useTranslation();
  const R = 104;
  const CX = 150;
  const CY = 128;
  /**
   * The stroke, fattened from 15 to 22.
   *
   * At 15 the ring read as a hairline diagram beside a 240px card of white,
   * and the bamboo — the one colour on this screen that means "how far along"
   * — was the thinnest mark on it. 22 is a fourteenth of the diameter, which
   * is the weight the ring-card comp draws, and it is what lets the fill be
   * seen from a metre away at a counter. `bamboo-600` on `--muted` is pinned
   * at 3.01:1 by the contrast test and nothing here changes that pair.
   */
  const STROKE = 22;
  const SWEEP = 240;
  /**
   * Degrees clockwise from twelve o'clock: 240° is the lower left, and sweeping
   * 240° clockwise from there ends at the lower right. That leaves the opening
   * at the bottom, under the value — which is the only arrangement where the
   * number reads as the thing the arc is measuring rather than as a caption
   * that happens to sit nearby.
   */
  const START = 240;

  const polar = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return { x: CX + R * Math.cos(rad), y: CY + R * Math.sin(rad) };
  };

  const a = polar(START);
  const b = polar(START + SWEEP);
  /** large-arc-flag 1 because the sweep exceeds 180°; sweep-flag 1 for clockwise. */
  const track = `M ${a.x.toFixed(2)} ${a.y.toFixed(2)} A ${R} ${R} 0 1 1 ${b.x.toFixed(2)} ${b.y.toFixed(2)}`;

  const arcLength = (SWEEP / 360) * 2 * Math.PI * R;
  const ratio = target > 0 ? Math.min(value / target, 1) : 0;
  const over = target > 0 && value > target;

  return (
    <figure
      className="relative m-0 mt-3 w-[300px] max-w-full"
      role="img"
      aria-label={t('ui.a.home.gauge', { value, target })}
    >
      <svg viewBox="0 0 300 196" width="300" className="block max-w-full">
        <path
          d={track}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={STROKE}
          strokeLinecap="round"
        />
        <path
          className="gauge-fill"
          d={track}
          fill="none"
          /*
           * Bamboo whether or not the target is behind you. Turning the ring
           * pass-green at 60 episodes made a shift's progress wear the colour
           * that means a collector was paid; the deeper step marks the
           * milestone without borrowing that meaning.
           */
          stroke={over ? 'var(--bamboo-700)' : 'var(--bamboo-600)'}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={arcLength}
          style={
            {
              '--sweep-from': `${arcLength}`,
              '--sweep-to': `${arcLength * (1 - ratio)}`,
              strokeDashoffset: arcLength * (1 - ratio),
            } as React.CSSProperties
          }
        />
      </svg>

      {/*
        Trúc, standing in the ring at the size the comp draws him — and drawn
        flat, not in three.js.

        `PandaStage` was here at `size={120}`, which is 61px of character in a
        186px ring: a toy in a hoop. Enlarging it was easy; facing him forward
        was not. The stage's camera is fixed at 34° on the z axis and the only
        rotation in it is a yaw the model takes from the pointer, clamped and
        zero at rest — so `truc.glb`, which is authored facing the camera's
        right, renders in profile whatever size it is passed. Measured, not
        assumed: with the pointer parked on the exact centre of the canvas and
        the scene settled for two seconds, the render is still a side view
        (`.impeccable/a/panda-centre.png`). Nothing in this route's scope can
        turn him; the fix is one `rotation.y` on the loaded scene inside
        `PandaStage`, which the identity track owns.

        So the ring gets the flat `Panda`, which is drawn front-facing from the
        same turnaround sheet, in the same six fills, and is what the ring-card
        comp shows. At 182px he stands with his shadow on the arc's lower ends
        and about 10px of air over his ears. He is also the same artwork the
        collector app ships, so the mascot at the centre of both products'
        first screen is now literally the same drawing.
      */}
      <div className="pointer-events-none absolute left-[150px] top-[100px] -translate-x-1/2 -translate-y-1/2">
        <Panda size={168} state={state} />
      </div>

      {/*
        The count, under the ring's opening rather than inside the arc.

        It is HTML and not an SVG `<text>` now: the numeral was competing with
        the character for the middle of the ring, and moving it below the gap is
        what let Trúc have the ring. Plain text also means it inherits the
        font stack and the locale's own digits instead of being a drawing of a
        number.
      */}
      <p className="num relative m-0 text-center text-[2.75rem] font-extrabold leading-none tracking-[-0.03em]">
        {value}
      </p>

      <figcaption className="mt-2 text-center text-[0.875rem] text-[var(--muted-foreground)]">
        {t('home.reviewed')} · {t('home.target')}{' '}
        <span className="num font-semibold text-[var(--foreground)]">{target}</span>
      </figcaption>
    </figure>
  );
}

/**
 * One measured quantity, sitting with the sentence that says what it is not.
 *
 * Deliberately not a card: the label reads at body size in sentence case, the
 * value is mono because it is measured, and the note is a full sentence
 * underneath. A big number with a small tracked label above it and an accent
 * under it is the template this refuses — it makes four unrelated figures look
 * like one comparable set, and two of these four are not money at all.
 */
function Figure({
  label,
  value,
  note,
  trailing,
}: {
  label: string;
  value: string | null;
  note: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-[var(--border)] py-4 last:border-0">
      {/*
        The note lives inside the `<dt>` rather than in a sibling paragraph:
        a `<dl>` group may hold only terms and descriptions, and the sentence
        belongs to the term — it says what this figure is, not what its value
        is. Flow content inside a `<dt>` is allowed and this keeps the markup
        a real description list instead of three divs pretending to be one.
      */}
      <dt className="text-[0.9375rem] font-semibold">
        {label}
        <span className="mt-1 block max-w-[52ch] text-[0.8125rem] font-normal leading-snug text-[var(--muted-foreground)]">
          {note}
        </span>
      </dt>
      {value === null ? (
        <dd className="m-0">
          <Skeleton className="h-7 w-24" />
        </dd>
      ) : (
        <dd className="m-0 flex items-center gap-2">
          {trailing}
          <span className="num text-[1.625rem] font-medium tracking-[-0.02em]">{value}</span>
        </dd>
      )}
    </div>
  );
}
