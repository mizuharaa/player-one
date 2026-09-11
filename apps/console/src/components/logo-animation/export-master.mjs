import { writeFileSync } from 'node:fs';
import { logoPieces, LOGO_VIEWBOX } from './logoPieces.ts';
import { sun, tech } from '../../../../../packages/design/src/tokens.ts';

// Node 22.18+ strips the TypeScript types. Export, never independently redraw.
function exportSvg(monochrome, dark = false) {
  const fragments = logoPieces.map(({ id, d, colorGroup }) => {
    const fill = monochrome ? 'currentColor' : colorGroup === 'player' ? sun[500] : tech[dark ? 400 : 600];
    return `  <g id="${id}" fill="${fill}"><path d="${d}" /></g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${LOGO_VIEWBOX}" fill="currentColor" role="img" aria-labelledby="playerone-title">
  <title id="playerone-title">PlayerOne</title>
${fragments}
</svg>
`;
}
writeFileSync(new URL('./playerone-wordmark.svg', import.meta.url), exportSvg(false));
writeFileSync(new URL('./playerone-wordmark-dark.svg', import.meta.url), exportSvg(false, true));
writeFileSync(new URL('./playerone-wordmark-monochrome.svg', import.meta.url), exportSvg(true));
