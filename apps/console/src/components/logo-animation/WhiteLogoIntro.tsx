import {useCallback, useEffect, useState} from 'react';
import {HeroLetterShuffle} from './HeroLetterShuffle';
import './white-logo-intro.css';

/** Presentation only: no focus trap, scroll lock or disabled page controls. */
export function WhiteLogoIntro({skipLabel}: {skipLabel: string}) {
  const [phase, setPhase] = useState<'intro' | 'leaving' | 'done'>(() =>
    typeof window === 'undefined' || matchMedia('(prefers-reduced-motion: reduce)').matches || location.hash || window.scrollY > 2 ? 'done' : 'intro');
  const leave = useCallback(() => setPhase(current => current === 'intro' ? 'leaving' : current), []);
  useEffect(() => {
    if (phase !== 'intro') return;
    const deadline = window.setTimeout(leave, 5000);
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') leave(); };
    const scroll = () => { if (window.scrollY > 4) leave(); };
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = () => { if (preference.matches) setPhase('done'); };
    window.addEventListener('keydown', key);
    window.addEventListener('hashchange', leave);
    window.addEventListener('scroll', scroll, {passive: true});
    preference.addEventListener('change', reduced);
    return () => {
      clearTimeout(deadline); window.removeEventListener('keydown', key);
      window.removeEventListener('hashchange', leave); window.removeEventListener('scroll', scroll);
      preference.removeEventListener('change', reduced);
    };
  }, [phase, leave]);
  useEffect(() => {
    if (phase !== 'leaving') return;
    const timer = window.setTimeout(() => setPhase('done'), 320);
    return () => clearTimeout(timer);
  }, [phase]);
  if (phase === 'done') return null;
  return <div className="white-logo-intro" data-phase={phase}>
    <div className="white-logo-intro__type" aria-hidden="true"><HeroLetterShuffle as="h2" onComplete={leave}/></div>
    <button type="button" className="white-logo-intro__skip" onClick={leave}>{skipLabel} <span aria-hidden="true">↘</span></button>
  </div>;
}
