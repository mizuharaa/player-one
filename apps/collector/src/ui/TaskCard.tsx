import { TaskPhotoLabel } from './TaskPhotoLabel.tsx';
import { taskDuration } from '../duration.ts';
import { Text, View, useWindowDimensions } from 'react-native';
import { Icon } from './Icon.tsx';
import { Image, type ImageSource } from 'expo-image';
import type { Task } from '../api/types.ts';
import { useT } from '../locale.tsx';
import { vnd } from '../money.ts';
import { useTheme } from '../theme.tsx';
import { face } from '../ui.tsx';
import { PhantomPressable } from './PhantomPressable.tsx';
import { taskImage } from './taskImage.ts';

export function TaskCard({ task, onPress, hint }: { task: Task; onPress: () => void; hint?: string }) {
  const theme = useTheme(), tt = useT(), c = theme.collector;
  const { fontScale } = useWindowDimensions();
  const type = task.scenario ?? task.type;
  const badge = type === 'home' || type === 'kitchen' ? 'taskCard.home' : type === 'office' ? 'scenario.office' : type === 'shop' ? 'scenario.shop' : type === 'warehouse' ? 'taskCard.warehouse' : 'taskCard.default';
  return <PhantomPressable pressedScale={.98} accessibilityRole="button" accessibilityLabel={task.title}
    accessibilityHint={hint ?? tt('explore.openTask')} onPress={onPress}
    style={{ backgroundColor: c.surface, borderRadius: 20, overflow: 'hidden' }}>
    <View testID="task-photo" style={{ width: '100%', aspectRatio: 2, overflow: 'hidden' }}>
      <Image source={taskImage(task) as unknown as ImageSource} contentFit="cover" contentPosition={type === 'home' || type === 'kitchen' ? 'bottom center' : 'center'} style={{ width: '100%', height: '100%' }} accessible={false} />
      <View style={{ position: 'absolute', top: 12, left: 12, maxWidth: '85%', backgroundColor: c.paper, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 4 }}>
        <Text style={{ ...c.type.caption, color: c.ink, fontFamily: face(theme) }}>{tt(badge)}</Text>
      </View>
      <TaskPhotoLabel />
    </View>
    <View style={{ padding: 16, gap: 8 }}>
      <Text style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), fontWeight: '700' }}>{task.title}</Text>
      <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{`${taskDuration(task.targetMinutes, tt)} · ${tt('taskCard.slots').replace('{count}', String(task.remainingSlots))}`}</Text>
      <View style={{ flexDirection: fontScale > 1.3 ? 'column' : 'row', flexWrap: 'wrap', alignItems: fontScale > 1.3 ? 'stretch' : 'center', gap: 12, marginTop: 4 }}>
        <View style={{ flexGrow: 1 }}>
          <Text testID="task-price" style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), fontWeight: '700', fontVariant: ['tabular-nums'] }}>{vnd(task.unitPriceVndPerMinute)}</Text>
          <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{tt('hall.perMinute')}</Text>
        </View>
        <View style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 24, backgroundColor: c.plum }}>
          <Text style={{ ...c.type.caption, color: c.surface, fontFamily: face(theme), fontWeight: '600', flexShrink: 1 }}>{tt('explore.openTask')}</Text>
          <Icon name="arrowUpRight" size={18} color={c.surface} />
        </View>
      </View>
    </View>
  </PhantomPressable>;
}
