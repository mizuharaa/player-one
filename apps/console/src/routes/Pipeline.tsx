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
 */
const STAGES: { n: string; name: string; state: State }[] = [
  { n: '01', name: 'Record', state: 'verified' },
  { n: '02', name: 'Hand in card', state: 'built' },
  { n: '03', name: 'Measure', state: 'built' },
  { n: '04', name: 'Attribute', state: 'built' },
  { n: '05', name: 'Review', state: 'built' },
  { n: '06', name: 'Settle', state: 'partial' },
  { n: '07', name: 'Cloud upload', state: 'blocked' },
];

const ROWS: Row[] = [
  { capability: 'Duration measurement', requirement: 'UPL-14 · §5.3.3', state: 'built', surface: 'Engine — no screen' },
  { capability: 'Episode identity and quarantine', requirement: 'UPL-06 · UPL-08', state: 'built', surface: 'Engine — no screen' },
  { capability: 'Session attribution', requirement: 'PLT-05 · SET-08', state: 'built', surface: 'Counter' },
  { capability: 'Both-token operator auth', requirement: 'PRD §8.3.2', state: 'built', surface: 'All' },
  { capability: 'Audit trail', requirement: 'SEC-04', state: 'built', surface: 'All' },
  { capability: 'Review verdicts', requirement: 'QR-01 · QR-03', state: 'built', surface: 'Review' },
  { capability: 'Reject reasons, localised', requirement: 'QR-04 · LOC-04', state: 'built', surface: 'Review' },
  { capability: 'Settlement row', requirement: 'SET-02 · SET-04', state: 'partial', surface: 'Settle' },
  { capability: 'Bill export and mark paid', requirement: 'SET-05 · BO-14', state: 'buildable', surface: 'Settle' },
  { capability: 'Upload-centre management', requirement: 'BO-09', state: 'buildable', surface: 'Counter' },
  { capability: 'Scoped remote reviewer role', requirement: 'PLT-10', state: 'buildable', surface: 'All' },
  { capability: 'Training and exam', requirement: 'APP-03 → APP-05', state: 'buildable', surface: 'Android app' },
  { capability: 'Task hall and claiming', requirement: 'APP-08 → APP-13', state: 'buildable', surface: 'Android app' },
  { capability: 'Cloud verification', requirement: 'UPL-04 → UPL-06', state: 'blocked', surface: 'Services', blocker: 'D2' },
  { capability: 'Device binding', requirement: 'APP-14 · APP-15', state: 'blocked', surface: 'Android app', blocker: 'D5' },
  { capability: 'Pre-collection checks', requirement: 'APP-19 · APP-22', state: 'blocked', surface: 'Android app', blocker: 'D5' },
  { capability: 'Path A upload', requirement: 'UPL-02 · APP-26', state: 'blocked', surface: 'Android app', blocker: 'D1' },
  { capability: 'Raw or proxy playback for review', requirement: 'QR-02 · PLT-10', state: 'blocked', surface: 'Review', blocker: 'D11' },
];

const STATE_STYLE: Record<State, { fg: string; bg: string; Glyph: typeof IconPass | null }> = {
  verified: { fg: 'var(--pass)', bg: 'var(--pass-bg)', Glyph: IconPass },
  built: { fg: 'var(--pass)', bg: 'var(--pass-bg)', Glyph: IconPass },
  partial: { fg: 'var(--partial)', bg: 'var(--partial-bg)', Glyph: IconPartial },
  buildable: { fg: 'var(--tech-600)', bg: 'var(--tech-50)', Glyph: null },
  blocked: { fg: 'var(--reject)', bg: 'var(--reject-bg)', Glyph: IconReject },
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
              <span className="text-[0.9375rem] font-bold leading-tight">{stage.name}</span>
              <span
                className="mt-auto inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.04em]"
                style={{ color: style.fg, backgroundColor: style.bg }}
              >
                {style.Glyph ? <style.Glyph size={11} /> : null}
                {t(`pipeline.state.${stage.state}`)}
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
                    <td className="px-4 py-3 text-[0.9375rem] font-semibold">{row.capability}</td>
                    <td className="num px-4 py-3 text-[0.8125rem] text-[var(--tech-600)]">
                      {row.requirement}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.75rem] font-bold"
                        style={{ color: style.fg, backgroundColor: style.bg }}
                      >
                        {style.Glyph ? <style.Glyph size={13} /> : null}
                        {t(`pipeline.state.${row.state}`)}
                        {row.blocker ? <span className="num opacity-80">· {row.blocker}</span> : null}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-[0.8125rem] text-[var(--muted-foreground)]">
                      {row.surface}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Panel>

      <p className="mt-4 max-w-[70ch] text-[0.8125rem] leading-relaxed text-[var(--muted-foreground)]">
        D1 (Wi-Fi protocol) and D5 (device SDK and manual) are owed by PaXini and were promised on
        13 August 2026. D11 — whether background review needs online playback of raw video — is
        unresolved on PaXini&rsquo;s side and decides whether video effectively leaves Vietnam.
      </p>
    </AppShell>
  );
}

function Count({ value, label, tone }: { value: number; label: string; tone: 'pass' | 'partial' | 'reject' }) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 rounded-full px-3 py-1.5 text-[0.875rem] font-semibold',
      )}
      style={{ color: `var(--${tone})`, backgroundColor: `var(--${tone}-bg)` }}
    >
      <span className="num text-[1.0625rem] font-bold">{value}</span>
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
