import { gsap } from 'gsap';
import { logoPieces } from './logoPieces';
import { choreographyForPiece, LOGO_ASSEMBLED_AT, LOGO_DURATION, sampleChoreography } from './logoChoreography';

interface LogoMotionOptions {
  svg: SVGSVGElement;
  carrier: HTMLDivElement;
  background: HTMLDivElement;
  target: SVGSVGElement | null;
  onComplete: () => void;
}

/** One clock owns fragment transforms; context owns its full lifetime. */
export function createLogoTimeline({ svg, carrier, background, target, onComplete }: LogoMotionOptions) {
  const timeline = gsap.timeline({ paused: true, onComplete });
  const svgStyle = getComputedStyle(svg);
  const targetStyle = target ? getComputedStyle(target) : svgStyle;
  const colors = {
    player: targetStyle.getPropertyValue('--logo-player').trim(),
    one: targetStyle.getPropertyValue('--logo-one').trim(),
  };
  const nodes = Array.from(svg.querySelectorAll<SVGGElement>('[data-logo-piece]'));
  const moves = nodes.map((node) => {
    const piece = logoPieces.find((candidate) => candidate.id === node.dataset.logoPiece);
    if (!piece) throw new Error('Unknown PlayerOne logo piece');
    const bbox = node.getBBox();
    const cx = bbox.x + bbox.width / 2;
    const cy = bbox.y + bbox.height / 2;
    const motion = choreographyForPiece(piece.id, cx, cy);
    gsap.set(node, {
      ...sampleChoreography(motion.waypoints, 0),
      svgOrigin: `${cx} ${cy}`, smoothOrigin: false,
      fill: svgStyle.color, opacity: 1, willChange: 'transform',
    });
    const label = svg.querySelector<SVGTextElement>(`[data-logo-label="${piece.id}"]`);
    return { node, piece, motion, label, cx, cy };
  });

  const clock = { time: 0 };
  const render = () => {
    for (const { node, motion, label, cx, cy } of moves) {
      const pose = sampleChoreography(motion.waypoints, clock.time);
      gsap.set(node, pose);
      if (label) {
        label.setAttribute('x', String(cx + pose.x));
        label.setAttribute('y', String(cy + pose.y - 12));
      }
    }
  };
  render();
  timeline.to(clock, { time: LOGO_ASSEMBLED_AT, duration: LOGO_ASSEMBLED_AT,
    ease: 'none', onUpdate: render }, 0);
  timeline.set(nodes, { clearProps: 'willChange' }, LOGO_ASSEMBLED_AT);
  // Colour starts only after every fragment reaches the exact natural SVG state.
  for (const { node, piece } of moves) {
    timeline.to(node, { fill: colors[piece.colorGroup], duration: .2, ease: 'sine.inOut' }, LOGO_ASSEMBLED_AT);
  }

  // Measure once, before any carrier transform. The captured target supports
  // deterministic backward scrubbing and never changes fragment geometry.
  const from = svg.getBoundingClientRect();
  const to = target?.isConnected ? target.getBoundingClientRect() : null;
  const docking = to?.width && from.width
    ? { x: to.left - from.left, y: to.top - from.top, scale: to.width / from.width }
    : { x: 0, y: 0, scale: 1 };
  gsap.set([carrier, background], { willChange: 'transform' });
  timeline.to(carrier, { ...docking, transformOrigin: '0 0', duration: .4, ease: 'power2.inOut' }, 1.1);
  timeline.to(background, { yPercent: -100, duration: .32, ease: 'power2.inOut' }, LOGO_DURATION - .32);
  return timeline;
}
