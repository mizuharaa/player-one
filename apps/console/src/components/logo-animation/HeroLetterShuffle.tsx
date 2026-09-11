import {useLayoutEffect, useRef} from 'react';
import {HERO_DURATION, HERO_TEXT, sampleHeroCharacter} from './heroShuffleTimeline';
import './hero-letter-shuffle.css';

/** Natural text reserves the complete footprint before the decorative layer runs. */
export function HeroLetterShuffle({animate = true, as: Tag = 'h1', onComplete}: {
  animate?: boolean; as?: 'h1' | 'h2'; onComplete?: () => void;
} = {}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const completed = useRef(onComplete);
  completed.current = onComplete;
  useLayoutEffect(() => {
    const root = heading.current;
    if (!root) return;
    if (!animate) { root.dataset.shuffleState = 'complete'; return; }
    const preference = matchMedia('(prefers-reduced-motion: reduce)');
    let disposed = false;
    let played = false;
    let ready = false;
    let visible = false;
    let frame = 0;
    let observer: IntersectionObserver | undefined;
    const slots = [...root.querySelectorAll<HTMLElement>('[data-shuffle-slot]')];
    const glyphs = slots.map(slot => slot.querySelector<HTMLElement>('.hero-shuffle__glyph')!);
    const finish = (notify = false) => {
      cancelAnimationFrame(frame);
      root.dataset.shuffleState = 'complete';
      root.style.removeProperty('opacity');
      root.style.removeProperty('transform');
      root.style.removeProperty('will-change');
      if (notify && !disposed) completed.current?.();
    };
    const begin = () => {
      if (disposed || played || !ready || !visible || preference.matches) return;
      played = true;
      observer?.disconnect();
      // Range uses the fully shaped word, including natural font kerning. Store
      // percentages so responsive font scaling never recreates the timeline.
      root.querySelectorAll<HTMLElement>('.hero-shuffle__word').forEach(word => {
        const baseline = word.querySelector<HTMLElement>('.hero-shuffle__baseline')!;
        const bounds = baseline.getBoundingClientRect();
        const text = baseline.firstChild!;
        word.querySelectorAll<HTMLElement>('[data-shuffle-slot]').forEach((slot, index) => {
          const range = document.createRange();
          range.setStart(text, index); range.setEnd(text, index + 1);
          const box = range.getBoundingClientRect();
          const left = box.left - bounds.left;
          slot.style.left = `${left / bounds.width * 100}%`;
          slot.style.width = `${box.width / bounds.width * 100}%`;
          const final = slot.querySelector<HTMLElement>('.hero-shuffle__final')!;
          final.style.left = `${-left / box.width * 100}%`;
          final.style.width = `${bounds.width / box.width * 100}%`;
        });
      });
      const motionScale = Math.min(1, root.clientWidth / 600);
      const started = performance.now();
      root.dataset.shuffleStarted = String(started);
      root.style.willChange = 'transform, opacity';
      const render = (now: number) => {
        if (disposed) return;
        const elapsed = now - started;
        if (elapsed >= HERO_DURATION) { finish(true); return; }
        const entrance = Math.min(1, elapsed / 150);
        root.dataset.shuffleState = elapsed >= 1900 ? 'hold' : 'playing';
        root.style.opacity = String(1 - (1 - entrance) ** 3);
        root.style.transform = `translateY(${6 * motionScale * (1 - entrance) ** 3}px)`;
        slots.forEach((slot, index) => {
          const state = sampleHeroCharacter(index, elapsed);
          if (glyphs[index]!.textContent !== state.glyph) glyphs[index]!.textContent = state.glyph;
          slot.dataset.locked = String(state.locked);
          slot.style.transform = `translateY(${state.y * motionScale}px)`;
        });
        frame = requestAnimationFrame(render);
      };
      render(started);
    };
    const changed = () => { if (preference.matches) { played = true; finish(true); observer?.disconnect(); } };
    preference.addEventListener('change', changed);
    if (preference.matches) finish(true);
    else {
      observer = new IntersectionObserver(entries => {
        visible = entries.some(entry => entry.isIntersecting);
        begin();
      }, {threshold: .5});
      observer.observe(root);
      const font = getComputedStyle(root);
      void document.fonts.load(`${font.fontWeight} ${font.fontSize} ${font.fontFamily}`, HERO_TEXT)
        .then(() => document.fonts.ready)
        .then(() => { ready = true; begin(); })
        .catch(() => { if (!disposed) finish(true); });
    }
    return () => {
      disposed = true; cancelAnimationFrame(frame); observer?.disconnect();
      preference.removeEventListener('change', changed);
      finish();
    };
  }, [animate]);
  let index = 0;
  return <Tag ref={heading} className="discover-display hero-shuffle" aria-label={HERO_TEXT} data-shuffle-state="ready">
    {HERO_TEXT.split(' ').map(word => <span className="hero-shuffle__word" key={word} aria-hidden="true">
      <span className="hero-shuffle__baseline">{word}</span>
      {[...word].map((letter, position) => <span key={position} className="hero-shuffle__slot" data-shuffle-slot={index++}>
        <span className="hero-shuffle__glyph">{letter}</span>
        <span className="hero-shuffle__final">{word}</span>
      </span>)}
    </span>)}
  </Tag>;
}
