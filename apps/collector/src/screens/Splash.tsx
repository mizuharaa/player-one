import { useEffect } from 'react';
import { AccessibilityInfo, Image, Pressable, Text, View } from 'react-native';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { face, useInsets } from '../ui.tsx';
import wordmark from '../../assets/discover/playerone-wordmark.png';

/** Static native fallback. Session restoration runs underneath this removable overlay. */
export function Splash({ onDone }: { onDone: () => void }) {
  const theme = useTheme();
  const tt = useT();
  const insets = useInsets();
  const c = theme.collector;
  useEffect(() => {
    let active = true;
    const finish = () => { if (active) { active = false; onDone(); } };
    const timer = setTimeout(finish, 400);
    void AccessibilityInfo.isReduceMotionEnabled().then(reduced => { if (reduced) finish(); }).catch(finish);
    return () => { active = false; clearTimeout(timer); };
  }, [onDone]);

  return <View style={{ position: 'absolute', inset: 0, backgroundColor: c.night }}>
    <Pressable accessibilityRole="button" accessibilityLabel={tt('common.next')} onPress={onDone}
      style={{ flex: 1, paddingHorizontal: c.gutter, paddingTop: insets.top, paddingBottom: insets.bottom + c.sectionGap }}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: c.sectionGap }}>
        <View style={{ width: '72%', aspectRatio: 784 / 152 }}>
          <Image source={wordmark} style={{ width: '100%', height: '100%' }} resizeMode="contain"
            tintColor={c.paper} accessibilityRole="image" accessibilityLabel={tt('app.name')} />
        </View>
        <Text style={{ fontFamily: face(theme), ...c.type.body, color: c.paper, textAlign: 'center' }}>{tt('splash.caption')}</Text>
      </View>
      <Text style={{ fontFamily: face(theme), ...c.type.caption, color: c.glow, textAlign: 'center' }}>{tt('splash.partners')}</Text>
    </Pressable>
  </View>;
}
