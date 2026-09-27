import { polish } from '../theme.tsx';
import { useEffect, useRef, useState } from 'react';
import { AppState, Text, View, useWindowDimensions } from 'react-native';
import { sun, tech } from '@playerone/design/tokens';
import { HERO_DURATION, HERO_TEXT, sampleHeroCharacter } from '@playerone/design/hero-shuffle';
import { useReducedMotion } from '../ui/motion.ts';

export let brandFrame: { x: number; y: number; width: number; height: number } | null = null;
export function BrandSlot({ color = polish.ink, measure = true, hero = false, ready = true }: { color?: string; measure?: boolean; hero?: boolean; ready?: boolean }) {
  const ref = useRef<View>(null);
  return <View ref={ref} collapsable={false} style={{ alignSelf: hero ? 'center' : 'flex-start' }} testID="brand-slot" {...{ dataSet: { brand: true } }}
    accessible={hero || undefined} accessibilityRole={hero ? 'image' : undefined} accessibilityLabel={hero ? 'PlayerOne' : undefined}
    onLayout={() => measure && ref.current?.measureInWindow((x, y, width, height) => { brandFrame = { x, y, width, height }; })}>
    {hero ? <HeroWordmark ready={ready} color={color} /> : <Text style={{ fontFamily: 'Be Vietnam Pro', fontSize: 30, lineHeight: 38, fontWeight: '600', letterSpacing: -1.2, color }}>PlayerOne</Text>}
  </View>;
}

/** The console's exact letter schedule, rendered with native text and stable slots. */
function HeroWordmark({ ready, color }: { ready: boolean; color: string }) {
  const { width } = useWindowDimensions(), reduced = useReducedMotion();
  const [elapsed, setElapsed] = useState(HERO_DURATION);
  const played = useRef(false);
  useEffect(() => {
    if (!ready || reduced) { setElapsed(HERO_DURATION); return; }
    if (played.current) return;
    let frame = 0;
    const finish = () => { cancelAnimationFrame(frame); setElapsed(HERO_DURATION); };
    const start = () => {
      if (played.current) return;
      played.current = true;
      const started = performance.now();
      const tick = (now: number) => {
        const time = Math.min(HERO_DURATION, now - started);
        setElapsed(time);
        if (time < HERO_DURATION) frame = requestAnimationFrame(tick);
      };
      setElapsed(0);
      frame = requestAnimationFrame(tick);
    };
    if (AppState.currentState === 'active') start();
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') start(); else if (played.current) finish();
    });
    return () => { cancelAnimationFrame(frame); subscription.remove(); };
  }, [ready, reduced]);
  const time = reduced || !ready ? HERO_DURATION : elapsed;
  const fontSize = Math.min(72, (width - 48) / 6.3);
  const type = { fontFamily: 'Be Vietnam Pro', fontSize, lineHeight: Math.ceil(fontSize * 1.12), fontWeight: '600' as const, letterSpacing: -fontSize * .03 };
  let index = 0;
  return <View testID="landing-wordmark" accessibilityElementsHidden importantForAccessibility="no-hide-descendants"
    style={{ flexDirection: 'row', columnGap: fontSize * .28 }}>
    {HERO_TEXT.split(' ').map((word, wordIndex) => <View key={word} style={{ flexDirection: 'row' }}>
      {[...word].map((letter, position) => {
        const state = sampleHeroCharacter(index++, time);
        return <View key={position} style={{ overflow: 'hidden' }}>
          <Text allowFontScaling={false} style={{ ...type, opacity: 0 }}>{letter}</Text>
          <Text allowFontScaling={false} numberOfLines={1} ellipsizeMode="clip" style={{ ...type, position: 'absolute', width: '100%', textAlign: 'center', color: time >= 1900 ? (wordIndex === 0 ? sun[700] : tech[600]) : color, transform: [{ translateY: state.y * Math.min(1, width / 600) }] }}>{state.glyph}</Text>
        </View>;
      })}
    </View>)}
  </View>;
}
