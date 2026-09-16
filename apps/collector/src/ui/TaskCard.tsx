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
    style={{ backgroundColor: c.surface, borderRadius: 20, overflow: 'hidden', flexDirection: fontScale > 1.3 ? 'column-reverse' : 'row' }}>
    <View style={{ flex: 1, padding: 16, gap: 8, justifyContent: 'center' }}>
      <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{tt(badge)}</Text>
      <Text numberOfLines={fontScale > 1.3 ? undefined : 3} style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme) }}>{task.title}</Text>
      <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{`${taskDuration(task.targetMinutes, tt)} · ${tt('taskCard.slots').replace('{count}', String(task.remainingSlots))}`}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <View style={{ flex: 1 }}>
          <Text testID="task-price" style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), fontWeight: '700', fontVariant: ['tabular-nums'] }}>{vnd(task.unitPriceVndPerMinute)}</Text>
          <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{tt('hall.perMinute')}</Text>
        </View>
        <Icon name="arrowUpRight" size={20} color={c.muted} />
      </View>
    </View>
      <View style={{ width: fontScale > 1.3 ? '100%' : '37%', minHeight: 180, overflow: 'hidden' }}>
        <Image source={taskImage(task) as unknown as ImageSource} contentFit="cover" style={{ width: '100%', height: '100%' }} accessible={false} />
        <TaskPhotoLabel />
      </View>
  </PhantomPressable>;
}
