import { logoPieces } from './logoPieces';
import { choreographyForPiece } from './logoChoreography';

/** Show the same source fragments before the optional GSAP chunk has arrived.
 * These native matrices are discarded synchronously when GSAP takes ownership.
 * They are geometry positioning, not a second animation or a placeholder mark.
 */
export function positionCompactGeometry(svg: SVGSVGElement): () => void {
  const restores: Array<() => void> = [];
  try {
    for (const node of svg.querySelectorAll<SVGGElement>('[data-logo-piece]')) {
      const motion = logoPieces.find(({ id }) => id === node.dataset.logoPiece);
      if (!motion) continue;
      const bbox = node.getBBox();
      const cx = bbox.x + bbox.width / 2;
      const cy = bbox.y + bbox.height / 2;
      const transform = node.getAttribute('transform');
      const origin = node.style.transformOrigin;
      const box = node.style.transformBox;
      restores.push(() => {
        if (transform === null) node.removeAttribute('transform');
        else node.setAttribute('transform', transform);
        node.style.transformOrigin = origin;
        node.style.transformBox = box;
      });
      const pose = choreographyForPiece(motion.id, cx, cy).waypoints[0]!;
      const angle = pose.rotation * Math.PI / 180;
      const a = Math.cos(angle) * pose.scale;
      const b = Math.sin(angle) * pose.scale;
      const e = cx + pose.x - a * cx + b * cy;
      const f = cy + pose.y - b * cx - a * cy;
      node.style.transformBox = 'view-box';
      node.style.transformOrigin = '0 0';
      node.setAttribute('transform', `matrix(${a} ${b} ${-b} ${a} ${e} ${f})`);
    }
  } catch (error) {
    restores.forEach((restore) => restore());
    throw error;
  }
  return () => restores.forEach((restore) => restore());
}
