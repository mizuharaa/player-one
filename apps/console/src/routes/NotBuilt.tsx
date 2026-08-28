/**
 * A destination that exists in the product and not yet in the code.
 *
 * The alternative is worse in both directions: hiding these from the navigation
 * teaches an operator a false map that changes under them later, and shipping an
 * empty table looks like a bug on a screen where a bug means somebody is not
 * being paid. So the page says what the surface is for, which requirement IDs
 * it covers, and how the work is done today — which for all three is the command
 * line, and that is a real answer.
 */
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Panel } from '../components/ui/primitives.tsx';
import { Button } from '../components/ui/button.tsx';
import { Cu } from '../components/identity/Cu.tsx';
import { IconArrow } from '../components/icons.tsx';

type Surface = 'counter' | 'episodes' | 'settle';

const DETAIL: Record<
  Surface,
  { titleKey: string; purpose: string; requirements: string; today: string }
> = {
  counter: {
    titleKey: 'nav.counter',
    purpose:
      'Recording a card handover, reconstructing what was recorded against a declared task, and importing the card on a fixed machine.',
    requirements: 'BO-09 · BO-10 · PLT-05 · UPL-08',
    today:
      'The whole counter workflow exists as API endpoints and is driven by the ingest CLI. `pnpm ingest` imports a card; the handover and session endpoints are exercised by a machine client. The BO-09 cut is deliberate; ADR 0003 records it and its trigger — a second centre, or 500 collectors, whichever comes first.',
  },
  episodes: {
    titleKey: 'nav.episodes',
    purpose:
      'Browsing every recording, with the filters operations asked for, and resolving the ones the attribution step refused to guess on.',
    requirements: 'BO-06 · BO-07 · PLT-05',
    today:
      'Episodes are queryable through `/upload-batches/:id/exceptions` and resolved through `/episodes/:id/resolve`. An unresolved episode is somebody’s unpaid recording sitting still, which is why Home surfaces the count even without this screen.',
  },
  settle: {
    titleKey: 'nav.settle',
    purpose:
      'Running a settlement, exporting the bill, and marking manual payment — with every step in the audit trail.',
    requirements: 'SET-02 · SET-04 · SET-05 · BO-14',
    today:
      'A verdict already writes its settlement row in the same transaction, so the money exists and is correct. What is missing is the run, the export and the mark-paid action. A settlement can only ever be reached through a review; there is deliberately no foreign key from a payment to a recording.',
  },
};

export function NotBuiltScreen({ surface }: { surface: Surface }) {
  const { t } = useTranslation();
  const detail = DETAIL[surface];

  return (
    <AppShell>
      <div className="mx-auto max-w-[54rem] py-6">
        <div className="flex flex-wrap items-start gap-6">
          <Cu size={116} className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.75rem] font-semibold uppercase tracking-[0.08em] text-[var(--faint-foreground)]">
              {t('nav.notBuilt')}
            </p>
            <h1 className="mt-1 text-[2.0625rem] font-extrabold tracking-[-0.03em]">
              {t(detail.titleKey)}
            </h1>
            <p className="mt-3 max-w-[58ch] text-[1.0625rem] leading-relaxed text-[var(--muted-foreground)]">
              {detail.purpose}
            </p>
            <p className="num mt-3 text-[0.875rem] font-semibold text-[var(--tech-600)]">
              {detail.requirements}
            </p>
          </div>
        </div>

        <Panel className="mt-8 p-6">
          <h2 className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]">
            How this is done today
          </h2>
          <p className="mt-2 max-w-[68ch] text-[0.9375rem] leading-relaxed">{detail.today}</p>
        </Panel>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild variant="primary">
            <Link to="/review">{t('home.start')}</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/pipeline">
              {t('pipeline.title')}
              <IconArrow size={17} />
            </Link>
          </Button>
        </div>
      </div>
    </AppShell>
  );
}
