/**
 * "We put back what you had typed", with a way to say no.
 *
 * A form that refills itself silently is its own defect: an operator who
 * abandoned an intake and came back to find it half-answered cannot tell
 * whether those answers are theirs, whose they are, or whether any of it was
 * already sent. A restore asks them to check before continuing: an intake may
 * already have written its handover. Discard sits next to the sentence.
 *
 * `role="status"` rather than `role="alert"`: a restored draft is good news
 * about a form that is working, not an interruption. Same treatment as the
 * read-only notice on the back office.
 */
import { useTranslation } from 'react-i18next';
import { Button } from './button.tsx';

export function DraftRestored({ onDiscard }: { onDiscard: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-base)] border border-[var(--border)] bg-[var(--muted)] px-4 py-3"
    >
      <p className="max-w-[62ch] text-[0.8125rem] leading-snug">{t('draft.restored')}</p>
      <Button variant="outline" size="sm" onClick={onDiscard}>
        {t('draft.discard')}
      </Button>
    </div>
  );
}
