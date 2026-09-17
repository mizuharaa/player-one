import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../components/ui/button.tsx';
import { duration } from '../lib/format.ts';
import type { DemoReviewAction, ReviewCatalog as Catalog, ReviewCatalogItem } from '../lib/api.ts';
import { Scrubber, markInSpan, markOutSpan, clearSpanAt, type Span } from './ReviewTimeline.tsx';
import './review-workbench.css';

export const optimizedUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}quality=preview`;

export function recordingTime(value: string | null, locale: string) {
  if (!value) return '—';
  const compact = /^(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]} ${compact[4]}:${compact[5]}:${compact[6]}`;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

export function ReviewCatalog({ data, pending, error, selected, busy, onSelect, onRefresh }: {
  data: Catalog | undefined; pending: boolean; error: Error | null;
  selected: string | null; busy: boolean;
  onSelect: (item: ReviewCatalogItem) => void; onRefresh: () => void;
}) {
  const { t, i18n } = useTranslation();
  return <section className="review-catalog" aria-label={t('review.catalog.recordings')}>
    <header className="review-catalog-heading">
      <div><h1>{t('review.catalog.recordings')}</h1><p>{t('review.catalog.choose')}</p></div>
      <Button variant="outline" disabled={pending} onClick={onRefresh}>{t('queue.refresh')}</Button>
    </header>
    <dl className="review-counts">
      {(['total', 'claimable', 'phone', 'blocked'] as const).map(key => <div key={key}>
        <dt>{t(`review.catalog.${key}`)}</dt><dd>{data?.counts[key] ?? '—'}</dd>
      </div>)}
    </dl>
    {error ? <div role="alert" className="review-catalog-error"><strong>{t('state.loadFailed.title')}</strong><p>{error.message}</p><Button variant="outline" onClick={onRefresh}>{t('queue.refresh')}</Button></div> : null}
    {pending ? <p role="status">{t('player.loading')}</p> : null}
    {data?.items.length === 0 ? <p className="review-catalog-empty">{t('review.catalog.empty')}</p> : null}
    {data && data.items.length > 0 ? <details key={selected ?? 'catalog'} className="review-catalog-list" open={selected === null}>
    <summary>{t(selected ? 'review.catalog.chooseAnother' : 'review.catalog.browse')}</summary>
    <div className="review-recordings" data-selected={selected ? 'true' : 'false'}>
      {data?.items.map(item => <button type="button" className="review-recording" key={item.episode_id}
        aria-pressed={selected === item.episode_id} disabled={busy} onClick={() => onSelect(item)}>
        <div className="review-recording-preview">
          {item.thumbnail_url ? <img src={item.thumbnail_url} alt="" loading="lazy" /> : <span>{t('review.catalog.previewAfterSelect')}</span>}
          <span className="review-recording-duration">{item.duration_seconds === null ? t('review.catalog.unmeasured') : duration(item.duration_seconds)}</span>
        </div>
        <div className="review-recording-copy">
          <span className="review-recording-source">{t(`review.catalog.${item.source}`)} · {item.claimable ? t('review.catalog.ready') : t(item.preview_url ? 'review.catalog.viewOnly' : 'review.catalog.blocked')}</span>
          <strong>{item.collector_label || item.collector_ref || t('meta.unknown')}</strong>
          {item.collector_ref && item.collector_ref !== item.collector_label ? <span>{item.collector_ref}</span> : null}
          <span>{item.filename || item.task_name || item.session_folder || item.episode_id}</span>
          <span>{t('meta.recorded')}: {recordingTime(item.recorded_at, i18n.language)}</span>
          <span>{t('review.catalog.uploaded')}: {recordingTime(item.uploaded_at, i18n.language)}</span>
          <span className="review-recording-state">{t(item.queue === 'privacy' ? 'queue.privacy' : item.queue === 'second_review' ? 'queue.secondReview' : 'queue.standard')} · {item.state.replaceAll('_', ' ')}</span>
          {item.demo_override ? <strong>{t('review.demo.simulation')} · {t(item.demo_override.decision ? `review.demo.${item.demo_override.decision}` : 'review.demo.pending')}</strong> : null}
        </div>
      </button>)}
    </div>
    </details> : null}
  </section>;
}

export function RecordingPreview({ item, actions }: { item: ReviewCatalogItem; actions?: ReactNode }) {
  const { t, i18n } = useTranslation();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(0);
  const [length, setLength] = useState(Number(item.duration_seconds) || 0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [spans, setSpans] = useState<Span[]>([]);
  const [controlError, setControlError] = useState(false);
  const seek = (seconds: number) => {
    if (!video.current || !Number.isFinite(video.current.duration)) return;
    video.current.currentTime = Math.max(0, Math.min(video.current.duration, seconds));
    setPosition(video.current.currentTime);
  };
  const togglePlay = () => {
    if (!video.current) return;
    if (!video.current.paused) video.current.pause();
    else void video.current.play().catch((error: unknown) => {
      if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'NotAllowedError')) return;
      setFailed(true);
    });
  };
  const available = Boolean(item.preview_url) && !failed;
  const marked = spans.reduce((sum, span) => sum + (span.end === null ? 0 : span.end - span.start), 0);
  return <section className="review-preview-only">
    <div className="review-preview-stage" ref={stage}>
      <div className="review-preview-screen">
      {available ? <video ref={video} key={`${item.episode_id}:${attempt}`} src={item.preview_url!} playsInline preload="metadata" muted={muted}
        onLoadedMetadata={() => { if (video.current && Number.isFinite(video.current.duration)) { setLength(video.current.duration); setPosition(video.current.currentTime); video.current.playbackRate = rate; } }}
        onTimeUpdate={() => setPosition(video.current?.currentTime ?? 0)} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)} onError={() => { setFailed(true); setPlaying(false); }} /> : <div>
        <h2>{t(failed ? 'state.mediaFailed.title' : 'review.catalog.previewUnavailable')}</h2>
        <p>{t(failed ? 'state.mediaFailed.body' : 'review.catalog.viewOnlyHint')}</p>
        {failed ? <Button variant="stage" onClick={() => { setFailed(false); setAttempt(n => n + 1); }}>{t('queue.refresh')}</Button> : null}
      </div>}
      </div>
      <div className="review-preview-transport">
        <Button variant="stage" disabled={!available} onClick={() => seek(position - 5)} aria-label={t('review.editor.back')}>−5s</Button>
        <Button variant="stage" disabled={!available} onClick={togglePlay}>{t(playing ? 'player.pause' : 'player.play')}</Button>
        <Button variant="stage" disabled={!available} onClick={() => seek(position + 5)} aria-label={t('review.editor.forward')}>+5s</Button>
        <output className="num">{duration(position)} / {duration(length)}</output>
        <label>{t('player.rate')} <select aria-label={t('player.rate')} value={rate} disabled={!available} onChange={event => { const next = Number(event.target.value); setRate(next); if (video.current) video.current.playbackRate = next; }}>{[.5, .75, 1, 1.5, 2, 3, 4].map(speed => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
        <Button variant="stage" disabled={!available} onClick={() => setMuted(value => !value)}>{t(muted ? 'review.editor.unmute' : 'review.editor.mute')}</Button>
        <Button variant="stage" disabled={!available} onClick={() => {
          setControlError(false);
          const result = document.fullscreenElement ? document.exitFullscreen?.() : stage.current?.requestFullscreen?.();
          if (!result) setControlError(true); else void result.catch(() => setControlError(true));
        }}>{t('review.editor.fullscreen')}</Button>
      </div>
      {controlError ? <p role="alert">{t('review.editor.fullscreenUnavailable')}</p> : null}
      <Scrubber position={position} measured={available ? length : 0} spans={spans} onSeek={seek} />
      <div className="review-preview-marks">
        <Button variant="stage" disabled={!available || length <= 0} onClick={() => setSpans(current => markInSpan(current, position))}>{t('shortcuts.markIn')}</Button>
        <Button variant="stage" disabled={!available || !spans.some(span => span.end === null && position > span.start)} onClick={() => setSpans(current => markOutSpan(current, position))}>{t('shortcuts.markOut')}</Button>
        <Button variant="stage" disabled={spans.length === 0} title={t('shortcuts.clear')} onClick={() => setSpans(current => clearSpanAt(current, position))}>{t('mark.clear')}</Button>
        <Button variant="stage" disabled={spans.length === 0} onClick={() => setSpans([])}>{t('review.editor.clearAll')}</Button>
      </div>
      <p className="review-local-note">{t('review.editor.localMarks')} <strong>{duration(marked)}</strong></p>
      {spans.length ? <ol className="review-preview-ranges">{spans.map((span, index) => <li key={index}><button onClick={() => seek(span.start)}>{duration(span.start)} — {span.end === null ? t('review.editor.openRange') : duration(span.end)}</button><button aria-label={`${t('review.editor.removeRange')} ${index + 1}`} onClick={() => setSpans(current => current.filter((_, i) => i !== index))}>×</button></li>)}</ol> : null}
    </div>
    <aside>{actions}<h2>{item.collector_label || item.collector_ref || t('meta.unknown')}</h2>
      <p>{item.filename || item.task_name || item.session_folder || item.episode_id}</p>
      {!item.demo_override ? <><strong>{t('review.catalog.viewOnly')}</strong><p>{t('review.catalog.viewOnlyHint')}</p></> : null}
      <dl><dt>{t('meta.recorded')}</dt><dd>{recordingTime(item.recorded_at, i18n.language)}</dd>
        <dt>{t('review.catalog.uploaded')}</dt><dd>{recordingTime(item.uploaded_at, i18n.language)}</dd>
        <dt>{t('review.catalog.duration')}</dt><dd>{item.duration_seconds === null ? t('review.catalog.unmeasured') : duration(item.duration_seconds)}</dd></dl>
      {item.blocker ? <details><summary>{t('meta.flags')}</summary><p>{item.blocker.replaceAll('_', ' ')}</p></details> : null}
    </aside>
  </section>;
}

export function DemoReviewControls({ item, busy, error, onAction }: {
  item: ReviewCatalogItem; busy: boolean; error: Error | null;
  onAction: (action: DemoReviewAction, reason: string) => void;
}) {
  const { t } = useTranslation();
  const [reason, setReason] = useState('');
  if (!item.demo_override_allowed) return null;
  return <section className="review-demo" aria-label={t('review.demo.simulation')}>
    <strong>{t('review.demo.simulation')}</strong>
    <p>{t('review.demo.hint')}</p>
    {item.demo_override ? <p role="status">{t('review.demo.saved')}: {t(item.demo_override.decision ? `review.demo.${item.demo_override.decision}` : 'review.demo.pending')}</p> : null}
    <label>{t('review.demo.reason')}<input value={reason} maxLength={500} disabled={busy} onChange={event => setReason(event.target.value)} /></label>
    <div className="flex flex-wrap gap-2">
      {item.queue !== 'standard' || !item.demo_override ? <Button disabled={busy} onClick={() => onAction('move_standard', reason.trim())}>{t('review.demo.move')}</Button> :
        (['accept', 'deny', 'flag'] as const).map(action => <Button key={action} variant={action === 'accept' ? 'primary' : 'outline'} disabled={busy} onClick={() => onAction(action, reason.trim())}>{t(`review.demo.${action}`)}</Button>)}
    </div>
    {error ? <p role="alert">{error.message}</p> : null}
  </section>;
}
