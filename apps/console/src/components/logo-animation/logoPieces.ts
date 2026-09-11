/** Original PlayerOne geometry, derived from the existing twin-lens mark.
 * Coordinates describe the finished lockup; animation never changes path data.
 * Stacked spare pieces sit inside the two source discs, rather than spawning.
 */
export interface LogoPieceMotion {
  id: string;
  startOffsetX: number;
  startOffsetY: number;
  startRotation: number;
  startScale: number;
  delayOffset: number;
  unfoldX: number;
  unfoldY: number;
  unfoldRotation: number;
}

export interface LogoPiece extends LogoPieceMotion {
  d: string;
  colorGroup: 'player' | 'one';
}

export const LOGO_VIEWBOX = '0 0 784 152';
export const LOGO_ORIGIN = { x: 392, y: 76 };

const rect = (x: number, y: number, w: number, h: number) =>
  `M${x} ${y}h${w}v${h}h-${w}Z`;
// Preserve the parent contour's winding for overlapping nonzero-filled joins.
const reverseRect = (x: number, y: number, w: number, h: number) =>
  `M${x} ${y}v${h}h${w}v-${h}Z`;
const disc = (x: number) => `M${x - 23} 73a23 23 0 1 0 46 0a23 23 0 1 0-46 0Z`;
// Small overlapping joins prevent antialiasing cracks between independently
// transformed pieces. They share the neighbouring stroke's exact silhouette.
const JOIN = .3;

// Explicit, non-random trajectories. Mixed stems, bowls and bars enter five
// mechanical beat groups. Scrambled rows form intentional abstract typography,
// with bounded spatial jumps rather than a radial particle explosion.
const piece = (id: string, d: string, x: number, y: number, r: number, scale: number,
  delay: number, ux: number, uy: number, ur: number): LogoPiece => ({
  id, d, colorGroup: /^(o-|n-|e2-|lens-right)/.test(id) ? 'one' : 'player',
  startOffsetX: x, startOffsetY: y, startRotation: r,
  startScale: scale, delayOffset: delay, unfoldX: ux, unfoldY: uy, unfoldRotation: ur,
});

export const logoPieces: readonly LogoPiece[] = [
  piece('p-stem-top', rect(108, 24, 17, 48 + JOIN), -13, 0, 0, .48, .06, -160, -22, 0),
  piece('p-stem-bottom', rect(108, 72, 17, 48), -13, 0, 0, .48, .09, 104, 22, 90),
  piece('p-bowl-top', 'M125 24h19c43 0 43 36 43 36h-17c0-18-10-20-26-20h-19Z' + rect(125 - JOIN, 24, JOIN * 2, 16), 13, -1, 90, .4, .14, -48, -22, -45),
  piece('p-bowl-bottom', 'M187 59c0 24-17 35-43 35h-19V78h19c15 0 26-3 26-19Z' + rect(125 - JOIN, 78, JOIN * 2, 16), 13, 1, -90, .4, .2, 152, 22, 45),
  piece('l-upper', rect(200, 24, 17, 48 + JOIN), -13, 0, 90, .5, .12, 16, -22, 90),
  piece('l-lower', rect(200, 72, 17, 48), -13, 0, 90, .5, .15, -104, 22, 0),
  piece('a-left', 'M260 56a32 32 0 0 0 0 64v-16a16 16 0 0 1 0-32Z' + reverseRect(260 - JOIN, 56, JOIN * 2, 16) + reverseRect(260 - JOIN, 104, JOIN * 2, 16), -13, -1, 0, .45, .08, 64, -22, 45),
  piece('a-right', 'M260 56a32 32 0 0 1 0 64v-16a16 16 0 0 0 0-32Z', 13, 1, 180, .45, .18, -152, 22, 90),
  piece('a-stem-top', rect(278, 58, 16, 31 + JOIN), -13, 0, 90, .48, .04, 128, -22, 0),
  piece('a-stem-bottom', rect(278, 89, 16, 31), -13, 0, 90, .48, .07, -16, 22, 45),
  piece('y-left', 'M306 58h18l20 43-9 20Z', -13, 1, -25, .43, .03, -80, -22, -12),
  // Both edges share the same slope: 38 units left over 86 units down.
  // The 14-unit overlap keeps the branch/tail union continuous at every scale.
  piece('y-right', 'M353 58h18l-26.511628 60h-18Z', 13, -1, 25, .43, .09, 48, 22, 12),
  piece('y-tail', 'M332.674419 104h18L333 144h-18Z', 13, 0, 25, .44, .21, 176, -22, 12),
  piece('e1-top', 'M386 88c0-43 62-43 62 0h-16c0-23-30-23-30 0Z', -13, 0, 180, .45, .1, -128, 22, 0),
  piece('e1-bottom', 'M386 88h16c0 20 25 23 36 10l11 11c-20 24-63 11-63-21Z' + rect(386, 88 - JOIN, 16, JOIN * 2), 13, 0, 0, .45, .15, 80, -22, 90),
  piece('e1-bar', rect(401, 80, 47, 16), -13, 0, 0, .48, .23, -176, 22, 0),
  piece('r-stem-top', rect(464, 58, 16, 31 + JOIN), -13, 0, 0, .48, .02, -16, -22, 0),
  piece('r-stem-bottom', rect(464, 89, 16, 31), -13, 0, 0, .48, .05, 128, 22, 90),
  piece('r-shoulder', 'M480 72c6-14 16-18 32-15v17c-21-5-32 6-32 20Z' + rect(480 - JOIN, 72, JOIN, 22), 13, 1, 180, .45, .17, -80, 22, 0),
  piece('o-top-left', 'M569 24c-25 0-38 17-38 48h17c0-21 7-32 21-32Z' + reverseRect(569 - JOIN, 24, JOIN * 2, 16) + reverseRect(531, 72 - JOIN, 17, JOIN * 2), -13, -1, 90, .43, .05, 152, -22, 45),
  piece('o-top-right', 'M569 24c25 0 38 17 38 48h-17c0-21-7-32-21-32Z' + rect(590, 72 - JOIN, 17, JOIN * 2), 13, -1, -90, .43, .11, -104, -22, -45),
  piece('o-bottom-left', 'M531 72c0 31 13 48 38 48v-16c-14 0-21-11-21-32Z' + reverseRect(569 - JOIN, 104, JOIN * 2, 16), -13, 1, -90, .43, .13, 16, 22, -45),
  piece('o-bottom-right', 'M607 72c0 31-13 48-38 48v-16c14 0 21-11 21-32Z', 13, 1, 90, .43, .19, -160, 22, 45),
  piece('n-stem-top', rect(627, 58, 16, 31 + JOIN), -13, 0, 0, .48, .07, 104, -22, 0),
  piece('n-stem-bottom', rect(627, 89, 16, 31), -13, 0, 0, .48, .1, -48, 22, 45),
  piece('n-arch', 'M643 67c19-23 48-9 48 15h-16c0-19-32-16-32 6Z' + rect(675, 82 - JOIN, 16, JOIN * 2) + rect(643 - JOIN, 67, JOIN, 21), 13, 0, 180, .44, .16, 48, -22, 0),
  piece('n-leg', rect(675, 81, 16, 39), 13, 0, 90, .48, .12, 80, 22, 90),
  piece('e2-top', 'M710 88c0-43 62-43 62 0h-16c0-23-30-23-30 0Z', -13, 0, 180, .45, .13, -152, -22, 0),
  piece('e2-bottom', 'M710 88h16c0 20 25 23 36 10l11 11c-20 24-63 11-63-21Z' + rect(710, 88 - JOIN, 16, JOIN * 2), 13, 0, 0, .45, .18, 64, 22, 90),
  piece('e2-bar', rect(725, 80, 47, 16), -13, 0, 0, .48, .24, -128, -22, 45),
  // These two same-colour faces cover the colocated fragments in phase A.
  // They remain real pieces and travel to the final two-lens brand symbol.
  piece('lens-left', disc(30), -13, 0, 0, 1, .0, -205, -22, 0),
  piece('lens-right', disc(55), 13, 0, 0, 1, .04, -205, 22, 0),
];

