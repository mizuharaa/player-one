import {expect,it} from 'vitest';
import {HERO_DURATION,HERO_LOCKS,HERO_TEXT,heroCharacters,sampleHeroCharacter} from './heroShuffleTimeline';
it('uses nine A-Z schedules, correct cadence, ordered locks and a settled final hold',()=>{
 expect(HERO_TEXT).toBe('PLAYER ONE');expect(HERO_DURATION).toBe(2300);expect(heroCharacters).toHaveLength(9);expect(Math.max(...HERO_LOCKS.slice(0,6))).toBeLessThan(Math.min(...HERO_LOCKS.slice(6)));
 heroCharacters.forEach((character,index)=>{expect(character.correct).toBe(HERO_TEXT.replace(' ','')[index]);for(let i=0;i<character.updates.length;i++){const update=character.updates[i]!;expect(update.glyph).toMatch(/^[A-Z]$/);expect(update.glyph).not.toBe(character.correct);const next=character.updates[i+1];if(next){const interval=next.at-update.at;expect(interval).toBeGreaterThanOrEqual(update.at>=character.lock-230?80:45);expect(interval).toBeLessThanOrEqual(update.at>=character.lock-230?110:65);}}
  expect(sampleHeroCharacter(index,character.lock).glyph).toBe(character.correct);expect(sampleHeroCharacter(index,character.lock).locked).toBe(true);
  expect(sampleHeroCharacter(index,character.lock).y).toBe(3);expect(sampleHeroCharacter(index,character.lock+120).y).toBe(0);
  for(const time of[1900,2000,2300,5000,10000])expect(sampleHeroCharacter(index,time)).toEqual({glyph:character.correct,locked:true,y:0});
 });
});
