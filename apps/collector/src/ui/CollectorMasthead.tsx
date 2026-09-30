import { Text, View } from 'react-native';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { polish, useTheme } from '../theme.tsx';
import { face } from '../ui.tsx';
import { Icon } from './Icon.tsx';
import { AvatarMark } from './illustrations/index.tsx';
import { PhantomPressable } from './PhantomPressable.tsx';

/** The same compact identity across the approved Home and Income compositions. */
export function CollectorMasthead() {
  const theme = useTheme(), c = theme.collector, nav = useNav(), tt = useT();
  return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingTop: 8, paddingBottom: 4 }}>
    <PhantomPressable accessibilityRole="button" accessibilityLabel={tt('tab.profile')} onPress={() => nav.selectTab('profile')}
      style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}>
      <AvatarMark size={44} />
    </PhantomPressable>
    <Text accessibilityRole="header" accessibilityLabel="PlayerOne" style={{ flex: 1, marginLeft: 8, fontFamily: face(theme), fontSize: 25, lineHeight: 34, letterSpacing: -.9, fontWeight: '700', color: c.ink }}>player<Text style={{ color: polish.brandOrange }}>one</Text></Text>
    <PhantomPressable accessibilityRole="button" accessibilityLabel={tt('profile.notifications')} onPress={() => nav.push({ name: 'notifications' })}
      style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center' }}><Icon name="bell" color={c.ink} fill={polish.notificationYellow} strokeWidth={2.1} size={25} /></PhantomPressable>
  </View>;
}
