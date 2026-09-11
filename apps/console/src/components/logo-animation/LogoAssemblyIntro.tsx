import { useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { discover } from '@playerone/design/tokens';
import type { gsap } from 'gsap';
import { AssemblyLogo } from './AssemblyLogo';
import { LOGO_DEBUG_TIME_SCALE, LOGO_FAIL_OPEN_MS } from './logoTiming';
import { positionCompactGeometry } from './compactGeometry';
import { LOGO_DURATION, MOTION_FAMILIES } from './logoChoreography';
import './logo-animation.css';

// Available only in development; opt in with ?logoDebug=1 so ordinary reloads
// retain the real visitor pacing. Production cannot activate these controls.
export const DEBUG_LOGO_ANIMATION = true;
export const LOGO_ASSEMBLY_STORAGE_KEY = 'playerone:logo-assembly:v1';
export type LogoIntroPlayMode = 'always' | 'once-per-session' | 'first-visit';
export interface LogoIntroResult { played: boolean }
export interface LogoAssemblyIntroProps {
  targetRef: RefObject<SVGSVGElement | null>;
  onComplete?: (result: LogoIntroResult) => void;
  playMode?: LogoIntroPlayMode;
  skip?: boolean;
  skipLabel?: string;
}

function storageFor(mode: LogoIntroPlayMode): Storage | null {
  try {
    return mode === 'once-per-session' ? window.sessionStorage
      : mode === 'first-visit' ? window.localStorage : null;
  } catch { return null; }
}

/** Mounted beside an already-rendered page; it never gates page loading. */
export function LogoAssemblyIntro({ targetRef, onComplete, playMode = 'always',
  skip = false, skipLabel = 'Skip intro' }: LogoAssemblyIntroProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const backgroundRef = useRef<HTMLDivElement>(null);
  const carrierRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const skipRef = useRef<HTMLButtonElement>(null);
  const timelineRef = useRef<gsap.core.Timeline | null>(null);
  const finishRef = useRef<(played: boolean) => void>(() => undefined);
  const completed = useRef(false);
  const completionRef = useRef(onComplete);
  completionRef.current = onComplete;
  const [visible, setVisible] = useState(true);
  const [debug, setDebug] = useState(false);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [slow, setSlow] = useState(true);
  const [family, setFamily] = useState('all');
  const [showIds, setShowIds] = useState(true);

  useLayoutEffect(() => {
    if (completed.current) return;
    const params = new URLSearchParams(window.location.search);
    const debugEnabled = import.meta.env.DEV && DEBUG_LOGO_ANIMATION && (params.get('logoDebug') === '1'
      || params.get('logo-intro') === 'debug' || import.meta.env.VITE_LOGO_ANIMATION_DEBUG === 'true');
    const replay = import.meta.env.DEV && (debugEnabled || params.get('logoReplay') === '1'
      || params.get('logo-intro') === 'replay' || import.meta.env.VITE_LOGO_INTRO_REPLAY === 'true');
    setDebug(debugEnabled);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    let seen = false;
    const storage = storageFor(playMode);
    try { seen = storage?.getItem(LOGO_ASSEMBLY_STORAGE_KEY) === '1'; } catch { /* Private storage. */ }
    const shouldSkip = skip || motion.matches || !!window.location.hash
      || (playMode !== 'always' && window.scrollY > 2) || (seen && !replay);
    const complete = (played: boolean) => {
      if (completed.current) return;
      completed.current = true;
      setVisible(false);
      completionRef.current?.({ played });
    };
    if (shouldSkip) { complete(false); return; }

    const overlay = overlayRef.current;
    const background = backgroundRef.current;
    const carrier = carrierRef.current;
    const svg = svgRef.current;
    if (!overlay || !background || !carrier || !svg) { complete(false); return; }

    const target = targetRef.current;
    const root = document.documentElement;
    const body = document.body;
    const original = {
      rootOverflow: root.style.overflow, bodyOverflow: body.style.overflow,
      gutter: root.style.scrollbarGutter, targetVisibility: target?.style.visibility ?? '',
      focused: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    };
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    let releasing = false;
    let context: gsap.Context | undefined;
    let restoreInitialGeometry: (() => void) | undefined;
    const restore = () => {
      root.style.overflow = original.rootOverflow;
      body.style.overflow = original.bodyOverflow;
      root.style.scrollbarGutter = original.gutter;
      if (target) target.style.visibility = original.targetVisibility;
      overlay.style.visibility = 'hidden';
      if (overlay.contains(document.activeElement) && original.focused?.isConnected) {
        original.focused.focus({ preventScroll: true });
      }
    };
    const finish = (played: boolean) => {
      if (disposed || completed.current) return;
      releasing = true;
      timelineRef.current?.kill();
      if (timeout) clearTimeout(timeout);
      removeListeners();
      try { storage?.setItem(LOGO_ASSEMBLY_STORAGE_KEY, '1'); } catch { /* Nonessential preference. */ }
      restore();
      context?.revert();
      restoreInitialGeometry?.();
      complete(played);
    };
    finishRef.current = finish;
    const onResize = () => finish(false);
    const onMotionChange = () => { if (motion.matches) finish(false); };
    const onFocus = (event: FocusEvent) => {
      if (!releasing && !completed.current && event.target instanceof Node && !overlay.contains(event.target)) {
        skipRef.current?.focus({ preventScroll: true });
      }
    };
    const onKey = (event: KeyboardEvent) => {
      if (completed.current) return;
      if (event.key === 'Escape') { event.preventDefault(); finish(false); }
      if (event.key !== 'Tab') return;
      const controls = Array.from(overlay.querySelectorAll<HTMLElement>('button, input, select'));
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    const removeListeners = () => {
      window.removeEventListener('resize', onResize);
      motion.removeEventListener('change', onMotionChange);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocus);
    };

    try {
      restoreInitialGeometry = positionCompactGeometry(svg);
      root.style.scrollbarGutter = 'stable';
      root.style.overflow = 'hidden';
      body.style.overflow = 'hidden';
      if (target) target.style.visibility = 'hidden';
      overlay.style.visibility = 'visible';
      window.addEventListener('resize', onResize);
      motion.addEventListener('change', onMotionChange);
      document.addEventListener('keydown', onKey);
      document.addEventListener('focusin', onFocus);
      skipRef.current?.focus({ preventScroll: true });
      // The deadline includes chunk loading. Even a stalled import fails open.
      timeout = setTimeout(() => finish(false), LOGO_FAIL_OPEN_MS);
      void Promise.all([import('gsap'), import('./logoMotion')]).then(([{ gsap }, { createLogoTimeline }]) => {
        if (disposed || completed.current) return;
        // Both operations are synchronous in one microtask: the assembled
        // final paths can never paint between native and GSAP ownership.
        restoreInitialGeometry?.();
        restoreInitialGeometry = undefined;
        context = gsap.context(() => undefined, overlay);
        context.add(() => {
          const timeline = createLogoTimeline({ svg, carrier, background, target,
            onComplete: () => { if (debugEnabled) setPlaying(false); else finish(true); } });
          timelineRef.current = timeline;
          if (debugEnabled) {
            if (timeout) clearTimeout(timeout);
            timeline.timeScale(LOGO_DEBUG_TIME_SCALE).eventCallback('onUpdate', () => setProgress(timeline.progress()));
          }
          timeline.play(0);
        });
      }).catch(() => finish(false));
    } catch { finish(false); }

    return () => {
      disposed = true;
      if (timeout) clearTimeout(timeout);
      removeListeners();
      context?.revert();
      restoreInitialGeometry?.();
      timelineRef.current = null;
      restore();
      finishRef.current = () => undefined;
    };
  }, [playMode, skip, targetRef]);

  if (!visible) return null;
  return (
    <div ref={overlayRef} className="logo-intro" data-debug={debug || undefined}
      style={{ '--logo-intro-ink': discover.ink } as CSSProperties}
      data-family-isolate={debug ? family : undefined} data-show-ids={debug && showIds || undefined}
      role="dialog" aria-modal="true" aria-label="PlayerOne">
      <div ref={backgroundRef} className="logo-intro__background" aria-hidden="true" />
      <div className="logo-intro__stage" aria-hidden="true">
        <div ref={carrierRef} className="logo-intro__carrier">
          <AssemblyLogo ref={svgRef} debug={debug} monochrome />
        </div>
      </div>
      <button ref={skipRef} className="logo-intro__skip" onClick={() => finishRef.current(false)}>{skipLabel}</button>
      {import.meta.env.DEV && debug && (
        <div className="logo-intro__debug">
          <label>Timeline <output>{(progress * LOGO_DURATION).toFixed(2)}s</output> / {LOGO_DURATION.toFixed(2)}s
            <input type="range" min="0" max="1" step="0.001" value={progress}
              aria-label="Logo timeline"
              onChange={(event) => {
                const next = Number(event.target.value);
                timelineRef.current?.pause().progress(next);
                setProgress(next); setPlaying(false);
              }} />
          </label>
          <div className="logo-intro__debug-controls">
            <button onClick={() => {
              const timeline = timelineRef.current;
              if (!timeline) return;
              if (playing) timeline.pause();
              else if (timeline.progress() === 1) timeline.restart();
              else timeline.play();
              setPlaying(!playing);
            }}>{playing ? 'Pause' : 'Play'}</button>
            <button aria-pressed={slow} onClick={() => {
              timelineRef.current?.timeScale(slow ? 1 : LOGO_DEBUG_TIME_SCALE); setSlow(!slow);
            }}>{slow ? '0.25× playback' : '1× playback'}</button>
            <label>Isolate family <select value={family} onChange={(event) => setFamily(event.target.value)}>
              <option value="all">All families</option>
              {MOTION_FAMILIES.map((name) => <option key={name} value={name}>{name}</option>)}
            </select></label>
            <label><input type="checkbox" checked={showIds} onChange={(event) => setShowIds(event.target.checked)} />Piece IDs</label>
          </div>
        </div>
      )}
    </div>
  );
}
