import { useRef, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useGuide } from '../guide/Guide.tsx';
import { face, useInsets, useReducedMotion } from '../ui.tsx';
import work from '../../assets/discover/work-portrait.webp';
import pointOfView from '../../assets/discover/pov-portrait.webp';
import camera from '../../assets/discover/review-poster.webp';

const CARDS = [
  { key: 'find', title: 'onboarding.findTitle', body: 'onboarding.findBody', photo: work },
  { key: 'wear', title: 'onboarding.wearTitle', body: 'onboarding.wearBody', photo: pointOfView },
  { key: 'paid', title: 'onboarding.paidTitle', body: 'onboarding.paidBody', photo: camera },
] as const;

/** Photographic introduction only: no qualification, consent, or payment mutation. */
export function Onboarding({ onDone }: { onDone: () => void }) {
  const theme = useTheme(), c = theme.collector, tt = useT();
  const insets = useInsets(), reduced = useReducedMotion(), guide = useGuide();
  const { width, height, fontScale } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [footer, setFooter] = useState(160);
  const pager = useRef<ScrollView>(null);
  const last = index === CARDS.length - 1;
  const go = (next: number) => {
    const page = Math.max(0, Math.min(CARDS.length - 1, next));
    setIndex(page);
    pager.current?.scrollTo({ x: page * width, animated: !reduced });
  };
  return <View style={{ flex: 1, backgroundColor: '#18231E' }}>
    <ScrollView ref={pager} horizontal pagingEnabled showsHorizontalScrollIndicator={false}
      onMomentumScrollEnd={event => setIndex(Math.max(0, Math.min(CARDS.length - 1, Math.round(event.nativeEvent.contentOffset.x / Math.max(1, width)))))}>
      {CARDS.map(card => <View key={card.key} style={{ width, minHeight: height }}>
        <Image source={card.photo} resizeMode="cover" accessible={false} style={StyleSheet.absoluteFill} />
        <LinearGradient pointerEvents="none" colors={['rgba(7,15,11,.18)', 'rgba(7,15,11,.3)', 'rgba(7,15,11,.92)']} locations={[0, .38, .76]} style={StyleSheet.absoluteFill} />
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'flex-end', paddingTop: insets.top + 80, paddingBottom: footer + 24, paddingHorizontal: 24, gap: 16 }}>
          <Text style={{ ...c.type.caption, fontFamily: face(theme), color: '#FFFFFF', letterSpacing: 2 }}>PLAYER ONE</Text>
          <Text accessibilityRole="header" style={{ fontFamily: face(theme), fontSize: fontScale > 1.3 ? 28 : 36, lineHeight: fontScale > 1.3 ? 36 : 44, fontWeight: '600', color: '#FFFFFF', letterSpacing: -.8 }}>{tt(card.title)}</Text>
          <Text style={{ ...c.type.body, color: '#FFFFFF', fontFamily: face(theme) }}>{tt(card.body)}</Text>
          <Text style={{ ...c.type.caption, color: '#FFFFFF', fontFamily: face(theme) }}>{tt('landing.illustrativeScenes')}</Text>
        </ScrollView>
      </View>)}
    </ScrollView>
    <View style={{ position: 'absolute', top: insets.top + 8, right: 16 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={tt('onboarding.skip')} onPress={onDone}
        style={({ pressed }) => ({ minHeight: 44, minWidth: 64, borderRadius: 24, backgroundColor: '#FFFFFF', paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', opacity: pressed ? .8 : 1 })}>
        <Text style={{ ...c.type.body, color: c.ink, fontFamily: face(theme), fontWeight: '600' }}>{tt('onboarding.skip')}</Text>
      </Pressable>
    </View>
    <View onLayout={event => setFooter(event.nativeEvent.layout.height)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(7,15,11,.9)', paddingHorizontal: 24, paddingBottom: Math.max(insets.bottom, 16) + 12, paddingTop: 4, gap: 8 }}>
      <View accessibilityRole="adjustable" accessibilityLabel={tt('onboarding.progress')}
        accessibilityValue={{ text: tt(CARDS[index]?.title ?? 'onboarding.findTitle'), min: 1, max: CARDS.length, now: index + 1 }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={event => go(index + (event.nativeEvent.actionName === 'decrement' ? -1 : 1))}
        style={{ minHeight: 44, flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
        {CARDS.map((card, i) => <View key={card.key} importantForAccessibility="no" style={{ width: i === index ? 36 : 16, height: 4, borderRadius: 2, backgroundColor: i === index ? '#FFFFFF' : '#829087' }} />)}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={tt(last ? 'onboarding.tour' : 'common.next')}
        style={({ pressed }) => ({ minHeight: 52, borderRadius: 28, backgroundColor: '#FFFFFF', padding: 12, alignItems: 'center', justifyContent: 'center', opacity: pressed ? .8 : 1 })} onPress={() => {
        if (!last) { go(index + 1); return; }
        onDone();
        guide.accept();
      }}><Text style={{ ...c.type.body, fontFamily: face(theme), fontWeight: '600', color: c.ink }}>{tt(last ? 'onboarding.tour' : 'common.next')}</Text></Pressable>
    </View>
  </View>;
}
