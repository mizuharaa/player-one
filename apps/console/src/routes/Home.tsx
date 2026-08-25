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
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button, Key } from '../components/ui/button.tsx';
import { Panel, Problem, Skeleton, VerdictPill } from '../components/ui/primitives.tsx';
import { Cu, CU_LABEL, cuStateAt } from '../components/identity/Cu.tsx';
import { IconAlert, IconArrow } from '../components/icons.tsx';
import { durationShort, money, pace } from '../lib/format.ts';
import { api, ApiError } from '../lib/api.ts';

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
        <Problem
          title="The shift figures did not load."
          body="Everything else on this screen still works. The counters come from the review database; if this keeps happening, the API cannot reach Postgres."
        />
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
        {/* --- The gauge. The page's one hero. --- */}
        <Panel className="flex flex-col items-center px-6 pb-6 pt-8">
          <p className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-foreground)]">
            {t('home.greeting')} · {shiftName}
          </p>

          {isPending ? (
            <Skeleton className="mt-6 h-[196px] w-[300px] rounded-full" />
          ) : (
            <Gauge value={data?.decided ?? 0} target={data?.target ?? 60} state={state} />
          )}

          <Button asChild variant="primary" size="lg" className="mt-6 w-full">
            <Link to="/review">
              {t('home.start')}
              <Key>R</Key>
            </Link>
          </Button>
        </Panel>

        {/* --- The three measured figures. --- */}
        <div className="grid gap-4 sm:grid-cols-2 lg:content-start">
          <Figure
            label={t('home.payable')}
            value={isPending ? null : durationShort(data?.payable_seconds ?? '0')}
            note="Effective duration from decided reviews only."
          />
          <Figure
            label={t('home.approval')}
            value={isPending ? null : approvalRate === null ? '—' : `${approvalRate}%`}
            note="Passes and partial passes, against every decision today."
            trailing={
              approvalRate === null ? null : (
                <VerdictPill verdict={approvalRate >= 85 ? 'good' : 'partial'} size="sm">
                  {data?.approved ?? 0}/{data?.decided ?? 0}
                </VerdictPill>
              )
            }
          />
          <Figure
            label={t('home.settled')}
            value={isPending ? null : money(data?.settled_amount, data?.currency ?? 'VND')}
            note="Your decisions only. Not the programme's spend."
          />
          <Figure
            label={t('queue.average')}
            value={isPending ? null : pace(data?.session_average_seconds)}
            note="Load to verdict. Instrumentation, never money."
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
  const { data, isPending } = useQuery({
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
          <div className="flex flex-col gap-2 p-4">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-2/3" />
          </div>
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
                          {t(`verdict.${verdict}`)}
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
function Gauge({ value, target, state }: { value: number; target: number; state: ReturnType<typeof cuStateAt> }) {
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
  const ratio = target > 0 ? Math.min(value / target, 1) : 0;
  const over = target > 0 && value > target;

  return (
    <figure
      className="m-0 mt-3"
      role="img"
      aria-label={`${value} of ${target} episodes reviewed this shift`}
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
          {value}
        </text>
      </svg>
      <figcaption className="mt-1 text-center text-[0.875rem] text-[var(--muted-foreground)]">
        episodes reviewed · target <span className="num font-semibold">{target}</span>
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
