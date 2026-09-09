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
 *
 * **The stage track is the hero**, and the numbers on it are the one place
 * this console uses section numbers: a recording passes through those seven
 * steps in that order, so the sequence is the information and not decoration.
 *
 * **No verdict colour and no verdict glyph on this page.** `--pass`,
 * `--partial` and their glyphs decide whether a collector is paid; a build
 * state wearing them teaches an operator that the check mark means "done"
 * somewhere it means "paid". Build progress is progress, so it is drawn in
 * bamboo, and the half-filled square (`IconPartialBuilt`) is the
 * implementation-status glyph rather than `IconPartial`. `blocked` keeps
 * `--reject`: it is the only state here that means stop, there is no verdict
 * anywhere on this screen to confuse it with, and the token is defined per
 * scheme so it holds in both.
 */
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Panel } from '../components/ui/primitives.tsx';
import { cn } from '../lib/cn.ts';
import { IconPartialBuilt } from '../components/icons.tsx';

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
  { capability: 'Card intake at the counter', requirement: 'BO-10 · APP-17b', state: 'built', surface: 'Counter' },
  { capability: 'Both-token operator auth', requirement: 'PRD §8.3.2', state: 'built', surface: 'All' },
  { capability: 'Audit trail', requirement: 'SEC-04', state: 'built', surface: 'All' },
  { capability: 'Review verdicts', requirement: 'QR-01 · QR-03', state: 'built', surface: 'Review' },
  { capability: 'Reject reasons, localised', requirement: 'QR-04 · LOC-04', state: 'built', surface: 'Review' },
  { capability: 'Tasks, collectors and devices', requirement: 'BO-01 → BO-04', state: 'built', surface: 'Back office' },
  { capability: 'Settlement row', requirement: 'SET-02 · SET-04', state: 'partial', surface: 'Settle' },
  { capability: 'Bill export and mark paid', requirement: 'SET-05 · BO-14', state: 'buildable', surface: 'Settle' },
  // BO-09 is the ADR 0003 cut — centres, machines and operators stay seeded.
  // It is a different requirement from the intake row above, on the same surface.
  { capability: 'Upload-centre management', requirement: 'BO-09', state: 'buildable', surface: 'Counter' },
  { capability: 'Scoped remote reviewer role', requirement: 'PLT-10', state: 'buildable', surface: 'All' },
  // APP-05's gate is enforced in the database; the training and the exam itself are not built.
  { capability: 'Training and exam', requirement: 'APP-03 → APP-05', state: 'partial', surface: 'Android app' },
  { capability: 'Task hall and claiming', requirement: 'APP-08 → APP-13', state: 'buildable', surface: 'Android app' },
  { capability: 'Cloud verification', requirement: 'UPL-04 → UPL-06', state: 'blocked', surface: 'Services', blocker: 'D2' },
  { capability: 'Device binding', requirement: 'APP-14 · APP-15', state: 'blocked', surface: 'Android app', blocker: 'D5' },
  { capability: 'Pre-collection checks', requirement: 'APP-19 · APP-22', state: 'blocked', surface: 'Android app', blocker: 'D5' },
  { capability: 'Path A upload', requirement: 'UPL-02 · APP-26', state: 'blocked', surface: 'Android app', blocker: 'D1' },
  { capability: 'Raw or proxy playback for review', requirement: 'QR-02 · PLT-10', state: 'blocked', surface: 'Review', blocker: 'D11' },
];

/**
 * How a state looks, and why in that order.
 *
 * `bamboo-500` is a fill under ink and never text (10.02:1 with `--stage` on
 * it, and `--stage` does not move with the scheme, so the pair holds in both).
 * `partial` is the neutral fill plus the half-filled square. `buildable` is a
 * hairline and muted type — the work is ready and nobody has started it, which
 * should read as the quietest state on the page rather than as a second brand
 * colour.
 */
const STATE_STYLE: Record<State, string> = {
  verified: 'bg-[var(--lime-500)] text-[var(--stage)]',
  built: 'bg-[var(--lime-500)] text-[var(--stage)]',
  partial: 'bg-[var(--muted)] text-[var(--foreground)]',
  buildable: 'border border-[var(--border-strong)] text-[var(--muted-foreground)]',
  /*
   * Blocked is not rejected. `reject` is one of the three colours that decide
   * whether a person is paid, and a requirement waiting on a hardware
   * deliverable from PaXini has nothing to do with any collector's money. It
   * is the machine reporting where the build stands, so it wears the system
   * ink and says the word.
   */
  blocked: 'bg-[var(--tech-50)] text-[var(--tech-ink)]',
};

function StatePill({ state, size = 'md' }: { state: State; size?: 'sm' | 'md' }) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        'inline-flex w-fit items-center gap-1 rounded-full font-bold',
        size === 'sm'
          ? 'px-2 py-0.5 text-[0.6875rem] uppercase tracking-[0.04em]'
          : 'px-2.5 py-1 text-[0.75rem]',
        STATE_STYLE[state],
      )}
    >
      {state === 'partial' ? <IconPartialBuilt size={size === 'sm' ? 11 : 13} /> : null}
      {t(`pipeline.state.${state}`)}
    </span>
  );
}

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
        <h1 className="headline">
          {t('pipeline.title')}
        </h1>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-[var(--muted-foreground)]">
          {t('pipeline.intro')}
        </p>
      </header>

      <div className="mt-5 flex flex-wrap gap-2">
        <Count value={counts.built} label={t('pipeline.built')} state="built" />
        <Count value={counts.next} label={t('pipeline.next')} state="partial" />
        <Count value={counts.blocked} label={t('pipeline.blocked')} state="blocked" />
      </div>

      {/* --- The hero: seven stages as one track, not seven identical cards. --- */}
      <section data-guide="pipeline.stage" className="mt-10">
        <h2 className="text-[0.9375rem] font-bold tracking-[-0.01em]">
          {t('ui.a.pipeline.track')}
        </h2>
        <ol className="mt-3 flex list-none gap-2 overflow-x-auto p-0 pb-2">
          {STAGES.map((stage) => (
            <li
              key={stage.n}
              className={cn(
                'flex min-w-[150px] flex-1 flex-col gap-2 rounded-[var(--radius-base)] border p-4',
                /*
                  A blocked stage gets the hatch — the same drawn ground the
                  empty states use. Step seven has no code behind it, and a
                  plain tile that looks exactly like the six built ones is how
                  somebody reads "cloud upload" as finished.
                */
                stage.state === 'blocked'
                  ? 'hatch border-[var(--border)]'
                  : 'border-[var(--border)] bg-[var(--card)]',
              )}
            >
              <span className="num text-[0.8125rem] font-semibold text-[var(--muted-foreground)]">
                {stage.n}
              </span>
              <span className="text-[1.0625rem] font-bold leading-tight tracking-[-0.01em]">
                {stage.name}
              </span>
              <span className="mt-auto pt-1.5">
                <StatePill state={stage.state} size="sm" />
              </span>
            </li>
          ))}
        </ol>
      </section>

      <Panel className="mt-10 overflow-hidden">
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
              {ROWS.map((row) => (
                <tr
                  key={row.capability}
                  className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--muted)]"
                >
                  <td className="px-4 py-3 text-[0.9375rem] font-semibold">{row.capability}</td>
                  <td className="num px-4 py-3 text-[0.8125rem] text-[var(--tech-ink)]">
                    {row.requirement}
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center gap-2">
                      <StatePill state={row.state} />
                      {/* The blocker's name is a reference, not a verdict. */}
                      {row.blocker ? (
                        <span className="num text-[0.75rem] font-semibold text-[var(--tech-ink)]">
                          {row.blocker}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[0.8125rem] text-[var(--muted-foreground)]">
                    {row.surface}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      <section className="mt-6 max-w-[70ch]">
        <h2 className="text-[0.9375rem] font-bold tracking-[-0.01em]">
          {t('ui.a.pipeline.owed')}
        </h2>
        <p className="mt-2 text-[0.875rem] leading-relaxed text-[var(--muted-foreground)]">
          <span className="num font-semibold text-[var(--foreground)]">D1</span> (Wi-Fi protocol)
          and <span className="num font-semibold text-[var(--foreground)]">D5</span> (device SDK and
          manual) are owed by PaXini and were promised on 13 August 2026.{' '}
          <span className="num font-semibold text-[var(--foreground)]">D11</span> — whether
          background review needs online playback of raw video — is unresolved on PaXini&rsquo;s
          side and decides whether video effectively leaves Vietnam.
        </p>
      </section>
    </AppShell>
  );
}

function Count({ value, label, state }: { value: number; label: string; state: State }) {
  return (
    <span
      className={cn(
        'inline-flex items-baseline gap-1.5 rounded-full px-3.5 py-1.5 text-[0.875rem] font-semibold',
        STATE_STYLE[state],
      )}
    >
      <span className="num text-[1.0625rem] font-bold">{value}</span>
      {label}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--muted-foreground)]">
      {children}
    </th>
  );
}
