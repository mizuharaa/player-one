/**
 * Home: what the shift has done, and the one action worth taking.
 *
 * The composition refuses the dashboard default — a row of four identical stat
 * cards above a table. There is exactly one hero here, the gauge, because there
 * is exactly one number a reviewer is judged on, and the primary action sits
 * directly under it so the distance between "how am I doing" and "carry on" is
 * one glance and one key.
 *
 * The three figures to its right are secondary by placement and by scale, not
 * by being shrunk versions of the same card. And the unresolved-episodes strip
 * at the bottom is not a metric at all: it is somebody's unpaid recording
 * sitting still, so it gets a sentence and a way in.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button, Key } from '../components/ui/button.tsx';
import { Loading, Panel, Problem, Skeleton, VerdictPill } from '../components/ui/primitives.tsx';
import { Cu, CU_LABEL, cuStateAt } from '../components/identity/Cu.tsx';
import { IconAlert, IconArrow } from '../components/icons.tsx';
import { durationShort, money, pace } from '../lib/format.ts';
import { api, ApiError } from '../lib/api.ts';
import { focusKind, shortcutFires } from '../lib/shortcuts.ts';

/**
 * What a figure reads when the server did not supply one.
 *
 * An em dash, not a translated word: it appears in a `.num` column beside real
 * measurements, and it must be the same width and the same shape in both
 * locales so a reviewer scanning the column sees "no answer" rather than a
 * short number.
 */
const UNKNOWN = '—';

/**
 * The three verdict words, written out.
 *
 * This was `t(`verdict.${verdict}`)`, which reads fine and is invisible to the
 * check that every key a screen asks for exists in both locales — the key never
 * appears in the source. Three literals cost nothing and are the thing the test
 * can see.
 */
const VERDICT_WORD = {
  good: 'verdict.good',
  partial: 'verdict.partial',
  bad: 'verdict.bad',
} as const;

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
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();

  /**
   * `R` starts reviewing.
   *
   * The primary action has printed `R` on itself since the screen was written
   * and nothing was listening for it, so the one shortcut on the one screen a
   * reviewer opens first was a promise the console did not keep. Reviewer
   * throughput is the programme's ceiling; a shortcut that is displayed and
   * does nothing costs more than one that is never displayed.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      /**
       * The same rule the review screen keeps, from the same table.
       *
       * It was a second hand-written copy of it — three tag checks — and the
       * copy was already narrower than the original: a keystroke aimed at a
       * `<span>` inside a text field arrives with that span as its target, and
       * `tagName === 'INPUT'` does not see it. One rule, in `lib/shortcuts.ts`,
       * where it is also the thing the shortcut test checks.
       */
      if (!shortcutFires(focusKind(event.target as HTMLElement | null), event.key)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'r' || event.key === 'R') void navigate({ to: '/review' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

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

  const state = cuStateAt();
  const shiftName = CU_LABEL[state][i18n.language === 'zh' ? 'zh' : 'en'];

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
          <Problem title={t('home.figuresFailed.title')} body={t('home.figuresFailed.body')} />
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* --- The gauge. The page's one hero. --- */}
        <Panel className="flex flex-col items-center px-6 pb-6 pt-8">
          <p className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-foreground)]">
            {t('home.greeting')} · {shiftName}
          </p>

          {isPending ? (
            <Loading label={t('state.loading')}>
              <Skeleton className="mt-6 h-[196px] w-[300px] rounded-full" />
            </Loading>
          ) : (
            <Gauge
              value={error ? null : (data?.decided ?? 0)}
              target={data?.target ?? 60}
              state={state}
            />
          )}

          <Button asChild variant="primary" size="lg" className="mt-6 w-full">
            <Link to="/review">
              {t('home.start')}
              <Key>R</Key>
            </Link>
          </Button>
        </Panel>

        {/*
          The four measured figures.

          When the shift call fails there is no figure to print, and printing a
          zero would be worse than printing nothing: `0:00` payable and `₫0`
          settled are readable claims about somebody's pay, and they would have
          been read as such. `UNKNOWN` is the dash, and the alert above says
          why it is there.
        */}
        <div className="grid gap-4 sm:grid-cols-2 lg:content-start">
          <Figure
            label={t('home.payable')}
            value={isPending ? null : error ? UNKNOWN : durationShort(data?.payable_seconds ?? '0')}
            note={t('home.payable.note')}
          />
          <Figure
            label={t('home.approval')}
            value={
              isPending ? null : error || approvalRate === null ? UNKNOWN : `${approvalRate}%`
            }
            note={t('home.approval.note')}
            trailing={
              error || approvalRate === null ? null : (
                <VerdictPill verdict={approvalRate >= 85 ? 'good' : 'partial'} size="sm">
                  {data?.approved ?? 0}/{data?.decided ?? 0}
                </VerdictPill>
              )
            }
          />
          <Figure
            label={t('home.settled')}
            value={
              isPending ? null : error ? UNKNOWN : money(data?.settled_amount, data?.currency ?? 'VND')
            }
            note={t('home.settled.note')}
          />
          <Figure
            label={t('queue.average')}
            value={isPending ? null : error ? UNKNOWN : pace(data?.session_average_seconds)}
            note={t('home.average.note')}
          />

          {/* --- The strip that is not a metric. --- */}
          {data && data.needs_human > 0 ? (
            <Link
              to="/episodes"
              className="group col-span-full flex items-center gap-3.5 rounded-[var(--radius-lg)] border border-[var(--sun-200)] bg-[var(--sun-50)] px-5 py-4 no-underline transition-colors duration-150 hover:border-[var(--sun-400)]"
            >
              <IconAlert size={20} className="shrink-0 text-[var(--sun-600)]" />
              <div className="min-w-0 flex-1">
                <p className="text-[0.9375rem] font-bold text-[var(--sun-700)]">
                  <span className="num">{data.needs_human}</span> {t('home.needsHuman')}
                </p>
                <p className="mt-0.5 text-[0.875rem] text-[var(--sun-700)]/80">
                  {t('home.needsHuman.body')}
                </p>
              </div>
              <IconArrow
                size={18}
                className="shrink-0 text-[var(--sun-600)] transition-transform duration-150 group-hover:translate-x-0.5"
              />
            </Link>
          ) : null}
        </div>
      </div>

      <RecentVerdicts currency={data?.currency ?? 'VND'} />
    </AppShell>
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
  const { data, isPending, isError } = useQuery({
    queryKey: ['recent'],
    queryFn: () => api.recent(),
  });

  const reviews = data?.reviews ?? [];

  return (
    <section className="mt-6">
      <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]">
        {t('recent.title')}
      </h2>

      <Panel className="mt-2 overflow-hidden">
        {isPending ? (
          <Loading label={t('state.loading')} className="flex flex-col gap-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-2/3" />
          </Loading>
        ) : isError ? (
          /*
            A failed read used to render as `recent.empty` — "No verdicts yet
            this session" — which tells a reviewer who has just committed four
            verdicts that they committed none. On a screen about pay, an error
            and an absence are not allowed to look alike.
          */
          <p
            role="alert"
            className="px-5 py-8 text-center text-[0.9375rem] leading-relaxed text-[var(--reject-ink)]"
          >
            {t('recent.failed')}
          </p>
        ) : reviews.length === 0 ? (
          <p className="px-5 py-8 text-center text-[0.9375rem] text-[var(--muted-foreground)]">
            {t('recent.empty')}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <tbody>
                {reviews.map((r) => {
                  const verdict =
                    r.reviewState === 'pass' ? 'good' : r.reviewState === 'partial_pass' ? 'partial' : 'bad';
                  return (
                    <tr
                      key={r.reviewId}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                    >
                      <td className="py-2.5 pl-5 pr-3">
                        <VerdictPill verdict={verdict} size="sm">
                          {t(VERDICT_WORD[verdict])}
                        </VerdictPill>
                      </td>
                      <td className="num px-3 py-2.5 text-[0.8125rem] text-[var(--muted-foreground)]">
                        {durationShort(r.measured)}
                        {' → '}
                        <span className="font-semibold text-[var(--foreground)]">
                          {durationShort(r.effective)}
                        </span>
                      </td>
                      <td className="num px-3 py-2.5 text-right text-[0.8125rem] font-semibold">
                        {money(r.amount, currency)}
                      </td>
                      <td className="num py-2.5 pl-3 pr-5 text-right text-[0.8125rem] text-[var(--faint-foreground)]">
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
 * The gauge: a 240° arc with Cú in the middle.
 *
 * An arc rather than a bar because it holds the target and the current value in
 * one shape at a size worth looking at, and because a bar that reaches its end
 * has nowhere left to go — a reviewer past target should see it, not see a full
 * bar. The sweep is the console's single authored motion: 900ms, once, on load.
 *
 * The value is also printed as text under the arc, and the whole figure carries
 * a `role="img"` label, because an arc alone is unreadable to a screen reader
 * and roughly unreadable at a glance to anyone comparing two numbers.
 */
function Gauge({
  value,
  target,
  state,
}: {
  /** `null` when the shift call failed: the arc empties and the number is a dash. */
  value: number | null;
  target: number;
  state: ReturnType<typeof cuStateAt>;
}) {
  const { t } = useTranslation();
  const R = 104;
  const CX = 150;
  const CY = 128;
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
  const ratio = value !== null && target > 0 ? Math.min(value / target, 1) : 0;
  const over = value !== null && target > 0 && value > target;

  return (
    <figure
      className="m-0 mt-3"
      role="img"
      aria-label={`${value ?? UNKNOWN} ${t('home.reviewed')} · ${t('home.target')} ${target}`}
    >
      <svg viewBox="0 0 300 198" width="300" className="max-w-full">
        <path d={track} fill="none" stroke="var(--muted)" strokeWidth="15" strokeLinecap="round" />
        <path
          className="gauge-fill"
          d={track}
          fill="none"
          stroke={over ? 'var(--pass)' : 'var(--sun-500)'}
          strokeWidth="15"
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

        <foreignObject x="112" y="40" width="76" height="76">
          <Cu size={76} state={state} />
        </foreignObject>

        <text
          x={CX}
          y="172"
          textAnchor="middle"
          className="num"
          style={{ fontSize: 42, fontWeight: 800, fill: 'var(--foreground)', letterSpacing: '-0.03em' }}
        >
          {value ?? UNKNOWN}
        </text>
      </svg>
      <figcaption className="mt-1 text-center text-[0.875rem] leading-snug text-[var(--muted-foreground)]">
        {t('home.reviewed')} · {t('home.target')}{' '}
        <span className="num font-semibold">{target}</span>
      </figcaption>
    </figure>
  );
}

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
    <Panel className="px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]">
          {label}
        </p>
        {trailing}
      </div>
      {value === null ? (
        <Skeleton className="mt-2 h-8 w-28" />
      ) : (
        <p className="num mt-1.5 text-[1.625rem] font-bold tracking-[-0.02em]">{value}</p>
      )}
      <p className="mt-1.5 text-[0.8125rem] leading-snug text-[var(--muted-foreground)]">{note}</p>
    </Panel>
  );
}
