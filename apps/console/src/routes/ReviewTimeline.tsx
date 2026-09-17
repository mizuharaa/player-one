import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button.tsx';
import { duration } from '../lib/format.ts';

export interface Span { start: number; end: number | null }

export function markInSpan(spans: Span[], position: number): Span[] {
  const open = spans.findIndex(span => span.end === null);
  return open < 0 ? [...spans, { start: position, end: null }] : spans.map((span, i) => i === open ? { start: position, end: null } : span);
}

export function markOutSpan(spans: Span[], position: number): Span[] {
  const open = spans.findIndex(span => span.end === null);
  return spans.map((span, i) => i === open && position > span.start ? { start: span.start, end: position } : span);
}

export const clearSpanAt = (spans: Span[], position: number) => spans.filter(span => !(position >= span.start && position <= (span.end ?? Infinity)));

/** The real time axis and marked ranges; no synthetic waveform or thumbnail track. */
export function Scrubber({ position, measured, spans, onSeek }: {
  position: number; measured: number; spans: Span[]; onSeek: (seconds: number) => void;
}) {
  const { t } = useTranslation();
  const [zoom, setZoom] = useState(1);
  const total = Number.isFinite(measured) && measured > 0 ? measured : 0;
  const bounded = (seconds: number) => Math.max(0, Math.min(total, seconds));
  const pct = (seconds: number) => total > 0 ? bounded(seconds) / total * 100 : 0;
  return <div className="review-timeline">
    <div className="review-timeline-heading">
      <strong>{t('review.editor.timeline')}</strong>
      <div><Button variant="stage" aria-label={t('review.editor.zoomOut')} disabled={zoom === 1} onClick={() => setZoom(n => Math.max(1, n / 2))}>−</Button>
        <output aria-label={t('review.editor.zoom')}>{zoom}×</output>
        <Button variant="stage" aria-label={t('review.editor.zoomIn')} disabled={zoom === 8} onClick={() => setZoom(n => Math.min(8, n * 2))}>+</Button></div>
    </div>
    <div className="review-timeline-scroll">
      <div className="review-timeline-canvas" style={{ width: `${zoom * 100}%` }}>
        <div className="review-timeline-ruler" aria-hidden="true">{[0, .25, .5, .75, 1].map(fraction => <span key={fraction}>{duration(total * fraction)}</span>)}</div>
        <div className="review-timeline-track">
          {spans.map((span, i) => <span key={i} className="review-timeline-span" data-open={span.end === null} style={{ left: `${pct(span.start)}%`, width: `${Math.max(0, pct(span.end ?? position) - pct(span.start))}%` }} />)}
          <input type="range" min={0} max={total || 1} step={.01} value={bounded(position)} disabled={total === 0}
            aria-label={t('player.position')} aria-valuetext={duration(position)} onChange={event => onSeek(bounded(Number(event.target.value)))}
            onKeyDown={event => {
              const next = event.key === 'ArrowLeft' ? position - (event.shiftKey ? .1 : 1) : event.key === 'ArrowRight' ? position + (event.shiftKey ? .1 : 1) : event.key === 'Home' ? 0 : event.key === 'End' ? total : null;
              if (next !== null) { event.preventDefault(); onSeek(bounded(next)); }
            }} />
        </div>
      </div>
    </div>
  </div>;
}
