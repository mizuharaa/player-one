import { expect, it } from 'vitest';
import { logoPieces } from './logoPieces';
import { choreographyForPiece, sampleChoreography, LOGO_ASSEMBLED_AT, LOGO_DURATION } from './logoChoreography';
it('keeps all 32 native glyph pieces unrotated and bounded through the fast register sequence', () => {
  expect(logoPieces).toHaveLength(32);expect(new Set(logoPieces.map(p=>p.id)).size).toBe(32);
  expect(LOGO_DURATION).toBe(1.5);expect(LOGO_ASSEMBLED_AT).toBe(.9);
  for(const piece of logoPieces){
    const {waypoints}=choreographyForPiece(piece.id,0,0);
    let previous=sampleChoreography(waypoints,0);
    for(let t=0;t<=LOGO_DURATION;t+=.005){const p=sampleChoreography(waypoints,t);expect(p.rotation).toBe(0);expect(Math.abs(p.x)).toBeLessThanOrEqual(Math.abs(previous.x)+.0001);expect(Math.abs(p.y)).toBeLessThanOrEqual(Math.abs(previous.y)+.0001);expect(p.scale).toBeGreaterThanOrEqual(previous.scale-.0001);expect(p.scale).toBeGreaterThanOrEqual(.6399);expect(p.scale).toBeLessThanOrEqual(1.0001);previous=p;}
    expect(sampleChoreography(waypoints,LOGO_ASSEMBLED_AT)).toEqual({x:0,y:0,rotation:0,scale:1});
  }
});
