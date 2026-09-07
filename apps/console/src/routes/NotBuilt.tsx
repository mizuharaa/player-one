/**
 * A destination that exists in the product and not yet in the code.
 *
 * The alternative is worse in both directions: hiding these from the navigation
 * teaches an operator a false map that changes under them later, and shipping an
 * empty table looks like a bug on a screen where a bug means somebody is not
 * being paid. So the page says what the surface is for, which requirement IDs
 * it covers, and how the work is done today — which is the command line, and
 * that is a real answer rather than "coming soon".
 *
 * `/episodes` used to arrive here. It does not any more: the attention scopes
 * of BO-05 are built (`routes/Episodes.tsx`) and that screen carries its own
 * sentence about the part of BO-05 that is not. `/counter` stays here by
 * decision, ADR 0003, and the decision has a trigger written into it.
 */
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button } from '../components/ui/button.tsx';
import { Panda } from '../components/identity/Panda.tsx';
import { IconArrow } from '../components/icons.tsx';

type Surface = 'counter' | 'settle';

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
      <div className="mx-auto max-w-[56rem] py-4">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
          {/*
            Trúc at golden hour: this page is a person finding a door that is
            not there yet, and the mascot is what says the screen rendered on
            purpose. He is decoration here and carries no label, so he is out
            of the accessibility tree.
          */}
          <Panda size={128} state="goldenHour" className="shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[0.875rem] font-semibold text-[var(--muted-foreground)]">
              {t('nav.notBuilt')}
            </p>
            <h1 className="mt-1 text-[2.625rem] font-extrabold leading-[1.05] tracking-[-0.035em]">
              {t(detail.titleKey)}
            </h1>
            <p className="mt-4 max-w-[58ch] text-[1.0625rem] leading-relaxed text-[var(--muted-foreground)]">
              {detail.purpose}
            </p>
            <p className="num mt-4 text-[0.875rem] font-semibold text-[var(--tech-ink)]">
              {detail.requirements}
            </p>
          </div>
        </div>

        {/*
          The hatch is the same ground the empty states use: this page is a
          drawn absence, not a page that failed to load. `data-guide` is the
          anchor the tour points at on `/counter`.
        */}
        <section
          data-guide="counter.plan"
          className="hatch mt-8 rounded-[var(--radius-lg)] border border-[var(--border)] p-6"
        >
          <h2 className="text-[0.9375rem] font-bold tracking-[-0.01em]">
            {t('ui.a.notBuilt.today')}
          </h2>
          <p className="mt-2 max-w-[68ch] text-[0.9375rem] leading-relaxed">{detail.today}</p>
        </section>

        <div className="mt-6 flex flex-wrap gap-3">
          <Button asChild variant="primary">
            <Link to="/review">{t('home.start')}</Link>
          </Button>
          <Button asChild variant="secondary">
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
