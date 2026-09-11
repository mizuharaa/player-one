import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const POSTER = '/discover-media/20260909/opening-poster.webp';
const FILM = '/discover-media/20260909/opening.mp4';

/** Presentation only: failure or blocked playback never gates the form. */
export function LoginFilm() {
  const { t } = useTranslation();
  const region = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [visible, setVisible] = useState(false);
  const [foreground, setForeground] = useState(() => !document.hidden);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [intent, setIntent] = useState<'auto' | 'play' | 'pause'>('auto');
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const updateMotion = () => { setReduced(preference.matches); setIntent('auto'); };
    const updateVisibility = () => setForeground(!document.hidden);
    preference.addEventListener('change', updateMotion);
    document.addEventListener('visibilitychange', updateVisibility);
    const observer = new IntersectionObserver(([entry]) => setVisible(entry?.isIntersecting ?? false), { threshold: 0.1 });
    if (region.current) observer.observe(region.current);
    return () => {
      preference.removeEventListener('change', updateMotion);
      document.removeEventListener('visibilitychange', updateVisibility);
      observer.disconnect();
      video.current?.pause();
    };
  }, []);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const saveData = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    const shouldPlay = visible && foreground && !failed && intent !== 'pause' && (intent === 'play' || (!reduced && !saveData));
    let active = true;
    if (shouldPlay) {
      void element.play().then(() => { if (!active) element.pause(); }).catch(() => { if (active) setPlaying(false); });
    } else element.pause();
    return () => { active = false; };
  }, [visible, foreground, reduced, intent, failed]);

  return <section ref={region} className="ops-login-film" aria-label={t('login.video.region')}>
    <img className="ops-login-poster" src={POSTER} alt="" />
    <video ref={video} src={FILM} poster={POSTER} muted loop playsInline preload="none" hidden={failed}
      aria-hidden="true" tabIndex={-1} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
      onError={() => { setFailed(true); setPlaying(false); }} />
    <div className="ops-login-film-copy">
      <h2>{t('ops.film')}</h2>
      <p>{t('ops.filmNote')}</p>
      {failed ? <p role="status">{t('ops.filmError')}</p> : <button type="button" className="ops-film-toggle"
        onClick={() => setIntent(playing ? 'pause' : 'play')}>
        <span aria-hidden="true">{playing ? 'Ⅱ' : '▷'}</span>{t(playing ? 'ops.pause' : 'ops.play')}
      </button>}
    </div>
  </section>;
}
