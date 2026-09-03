/**
 * Pipeline: what is actually built.
 *
 * This screen exists because the programme's honest state is hard to hold in
 * anybody's head — seven capabilities built, several partial, five blocked on
 * deliverables another company owes — and because the alternative is a status
 * document that goes stale the week it is written. Everything here is either a
 * requirement ID from the brief or a live count from the database.
 *
 * The content is deliberately not invented. Each row names the requirement it
 * implements and the surface it lives on, and a blocked row names the
 * deliverable that blocks it (D1, D2, D5) rather than saying "coming soon".
 * A blocked item with a named owner is a thing somebody can chase.
 */
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Panel } from '../components/ui/primitives.tsx';
import { cn } from '../lib/cn.ts';
import { IconPass, IconPartial, IconReject } from '../components/icons.tsx';

type State = 'verified' | 'built' | 'partial' | 'buildable' | 'blocked';

interface Row {
  /** A catalogue key, not a sentence: this table is read in both locales. */
  capability: string;
  requirement: string;
  state: State;
  surface: string;
  /** Only on blocked rows: the deliverable that has not arrived. */
  blocker?: string;
}

/**
 * The stages a recording passes through, in order.
 *
 * Seven steps, and the pilot currently reaches step six. Step seven is the
 * cloud, which does not exist — which is also why `ADR 0001` lets review read
 * the local integrity check instead of a cloud receipt.
 *
 * The names and the surfaces are catalogue keys rather than English literals.
 * They were literals, which meant a Chinese reviewer got a translated page
 * heading over an English table — the split this console's one catalogue
 * exists to prevent. The requirement IDs are not translated: `UPL-14` is
 * printed that way in the brief in every language, and a reviewer chasing a
 * blocker quotes the ID.
 */
const STAGES: { n: string; key: string; state: State }[] = [
  { n: '01', key: 'pipeline.stage.record', state: 'verified' },
  { n: '02', key: 'pipeline.stage.handover', state: 'built' },
  { n: '03', key: 'pipeline.stage.measure', state: 'built' },
  { n: '04', key: 'pipeline.stage.attribute', state: 'built' },
  { n: '05', key: 'pipeline.stage.review', state: 'built' },
  { n: '06', key: 'pipeline.stage.settle', state: 'partial' },
  { n: '07', key: 'pipeline.stage.upload', state: 'blocked' },
];

const ROWS: Row[] = [
  { capability: 'pipeline.cap.duration', requirement: 'UPL-14 · §5.3.3', state: 'built', surface: 'pipeline.surface.engine' },
  { capability: 'pipeline.cap.identity', requirement: 'UPL-06 · UPL-08', state: 'built', surface: 'pipeline.surface.engine' },
  { capability: 'pipeline.cap.attribution', requirement: 'PLT-05 · SET-08', state: 'built', surface: 'pipeline.surface.counter' },
  { capability: 'pipeline.cap.auth', requirement: 'PRD §8.3.2', state: 'built', surface: 'pipeline.surface.all' },
  { capability: 'pipeline.cap.audit', requirement: 'SEC-04', state: 'built', surface: 'pipeline.surface.all' },
  { capability: 'pipeline.cap.verdicts', requirement: 'QR-01 · QR-03', state: 'built', surface: 'pipeline.surface.review' },
  { capability: 'pipeline.cap.reasons', requirement: 'QR-04 · LOC-04', state: 'built', surface: 'pipeline.surface.review' },
  { capability: 'pipeline.cap.settlementRow', requirement: 'SET-02 · SET-04', state: 'partial', surface: 'pipeline.surface.settle' },
  { capability: 'pipeline.cap.bill', requirement: 'SET-05 · BO-14', state: 'buildable', surface: 'pipeline.surface.settle' },
  { capability: 'pipeline.cap.centres', requirement: 'BO-09', state: 'buildable', surface: 'pipeline.surface.counter' },
  { capability: 'pipeline.cap.reviewerRole', requirement: 'PLT-10', state: 'buildable', surface: 'pipeline.surface.all' },
  { capability: 'pipeline.cap.training', requirement: 'APP-03 → APP-05', state: 'buildable', surface: 'pipeline.surface.app' },
  { capability: 'pipeline.cap.taskHall', requirement: 'APP-08 → APP-13', state: 'buildable', surface: 'pipeline.surface.app' },
  { capability: 'pipeline.cap.cloudVerify', requirement: 'UPL-04 → UPL-06', state: 'blocked', surface: 'pipeline.surface.services', blocker: 'D2' },
  { capability: 'pipeline.cap.deviceBinding', requirement: 'APP-14 · APP-15', state: 'blocked', surface: 'pipeline.surface.app', blocker: 'D5' },
  { capability: 'pipeline.cap.preChecks', requirement: 'APP-19 · APP-22', state: 'blocked', surface: 'pipeline.surface.app', blocker: 'D5' },
  { capability: 'pipeline.cap.pathA', requirement: 'UPL-02 · APP-26', state: 'blocked', surface: 'pipeline.surface.app', blocker: 'D1' },
  { capability: 'pipeline.cap.playback', requirement: 'QR-02 · PLT-10', state: 'blocked', surface: 'pipeline.surface.review', blocker: 'D11' },
];

/**
 * The word for each state is a written-out key rather than a computed one.
 *
 * `t(`pipeline.state.${state}`)` reads fine and is invisible to the check that
 * every key a screen asks for exists in both locales — the key never appears
 * in the source, so a state added here with no catalogue row would render its
 * own name on the page in both languages. Five literals cost nothing and are
 * the thing the test can see.
 */
const STATE_STYLE: Record<
  State,
  { fg: string; bg: string; Glyph: typeof IconPass | null; key: string }
> = {
  verified: { fg: 'var(--pass)', bg: 'var(--pass-bg)', Glyph: IconPass, key: 'pipeline.state.verified' },
  built: { fg: 'var(--pass)', bg: 'var(--pass-bg)', Glyph: IconPass, key: 'pipeline.state.built' },
  partial: { fg: 'var(--partial)', bg: 'var(--partial-bg)', Glyph: IconPartial, key: 'pipeline.state.partial' },
  buildable: { fg: 'var(--tech-600)', bg: 'var(--tech-50)', Glyph: null, key: 'pipeline.state.buildable' },
  blocked: { fg: 'var(--reject)', bg: 'var(--reject-bg)', Glyph: IconReject, key: 'pipeline.state.blocked' },
};

export function PipelineScreen() {
  const { t } = useTranslation();

  const counts = {
    built: ROWS.filter((r) => r.state === 'built' || r.state === 'verified').length,
    next: ROWS.filter((r) => r.state === 'buildable' || r.state === 'partial').length,
    blocked: ROWS.filter((r) => r.state === 'blocked').length,
  };

  return (
    <AppShell>
      <header className="max-w-[62ch]">
        <h1 className="text-[2.0625rem] font-extrabold leading-[1.12] tracking-[-0.03em]">
          {t('pipeline.title')}
        </h1>
        <p className="mt-3 text-[1.0625rem] leading-relaxed text-[var(--muted-foreground)]">
          {t('pipeline.intro')}
        </p>
      </header>

      <div className="mt-6 flex flex-wrap gap-2">
        <Count value={counts.built} label={t('pipeline.built')} tone="pass" />
        <Count value={counts.next} label={t('pipeline.next')} tone="partial" />
        <Count value={counts.blocked} label={t('pipeline.blocked')} tone="reject" />
      </div>

      {/* The seven stages, as a track rather than seven identical cards. */}
      <ol className="mt-8 flex gap-1 overflow-x-auto pb-2">
        {STAGES.map((stage) => {
          const style = STATE_STYLE[stage.state];
          return (
            <li
              key={stage.n}
              className="flex min-w-[128px] flex-1 flex-col gap-1.5 rounded-[var(--radius-base)] border border-[var(--border)] bg-[var(--card)] px-3.5 py-3"
            >
              <span className="num text-[0.75rem] font-semibold text-[var(--faint-foreground)]">
                {stage.n}
              </span>
              <span className="text-[0.9375rem] font-bold leading-tight">{t(stage.key)}</span>
              <span
                className="mt-auto inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.04em] text-[var(--foreground)]"
                style={{ backgroundColor: style.bg }}
              >
                {style.Glyph ? <style.Glyph size={11} style={{ color: style.fg }} /> : null}
                {t(style.key)}
              </span>
            </li>
          );
        })}
      </ol>

      <Panel className="mt-8 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <Th>{t('pipeline.capability')}</Th>
                <Th>{t('pipeline.requirement')}</Th>
                <Th>{t('pipeline.state')}</Th>
                <Th>{t('pipeline.surface')}</Th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => {
                const style = STATE_STYLE[row.state];
                return (
                  <tr
                    key={row.capability}
                    className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                  >
                    <td className="px-4 py-3 text-[0.9375rem] font-semibold">
                      {t(row.capability)}
                    </td>
                    <td className="num px-4 py-3 text-[0.8125rem] text-[var(--tech-600)]">
                      {row.requirement}
                    </td>
                    <td className="px-4 py-3">
                      {/* Hue on the glyph and the tint, ink on the word — see `VerdictPill`. */}
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-bold text-[var(--foreground)]"
                        style={{ backgroundColor: style.bg }}
                      >
                        {style.Glyph ? <style.Glyph size={13} style={{ color: style.fg }} /> : null}
                        {t(style.key)}
                        {row.blocker ? <span className="num opacity-80">· {row.blocker}</span> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[0.8125rem] text-[var(--muted-foreground)]">
                      {t(row.surface)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="mt-4 max-w-[70ch] text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
        {t('pipeline.footnote')}
      </p>
      {/*
        Said on the screen, because the table looks like a query and is not one.
        `STAGES` and `ROWS` above are hand-kept constants; nothing here counts a
        database. Anybody reading this page during integration is looking at a
        dated record, and the date is the only thing that makes that honest.
      */}
      <p className="mt-2 max-w-[70ch] text-[0.75rem] leading-relaxed text-[var(--faint-foreground)]">
        {t('pipeline.provenance')}
      </p>
    </AppShell>
  );
}

function Count({ value, label, tone }: { value: number; label: string; tone: 'pass' | 'partial' | 'reject' }) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 rounded-full px-3 py-1.5 text-[0.875rem] font-semibold',
        'text-[var(--foreground)]',
      )}
      style={{ backgroundColor: `var(--${tone}-bg)` }}
    >
      <span className="num text-[1.0625rem] font-bold" style={{ color: `var(--${tone})` }}>
        {value}
      </span>
      {label}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]">
      {children}
    </th>
  );
}
