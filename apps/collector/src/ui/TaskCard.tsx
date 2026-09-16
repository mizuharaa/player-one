import { TaskPhotoLabel } from './TaskPhotoLabel.tsx';
import { taskDuration } from '../duration.ts';
import { polish } from '../theme.tsx';
import { CardSheen, paperCard } from './CardSheen.tsx';
import { StyleSheet, Text, View } from 'react-native';
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
  const type = task.scenario ?? task.type;
  const badge = type === 'home' || type === 'kitchen' ? 'taskCard.home' : type === 'office' ? 'scenario.office' : type === 'shop' ? 'scenario.shop' : type === 'warehouse' ? 'taskCard.warehouse' : 'taskCard.default';
  return <PhantomPressable pressedScale={.98} accessibilityRole="button" accessibilityLabel={task.title}
    accessibilityHint={hint ?? tt('explore.openTask')} onPress={onPress}
    style={{ ...paperCard, overflow: 'hidden' }}>
    {({ pressed }) => <>
      <View style={{ aspectRatio: 4 / 3, borderRadius: 16, overflow: 'hidden' }}>
        <Image source={taskImage(task) as unknown as ImageSource} contentFit="cover" style={{ width: '100%', height: '100%' }} accessible={false} />
        <TaskPhotoLabel />
        <View style={{ position: 'absolute', top: 12, left: 12, maxWidth: '85%', backgroundColor: polish.badge, borderRadius: 24, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ ...c.type.caption, color: c.ink, fontFamily: face(theme), fontWeight: '600' }}>{tt(badge)}</Text>
        </View>
      </View>
      <View style={{ padding: 16, gap: 8, overflow: 'hidden' }}>
        <CardSheen pressed={pressed} />
        <Text numberOfLines={2} style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme) }}>{task.title}</Text>
        <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{`${taskDuration(task.targetMinutes, tt)} \u00b7 ${tt('taskCard.slots').replace('{count}', String(task.remainingSlots))}`}</Text>
        <Text testID="task-price" style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), fontWeight: '700', fontVariant: ['tabular-nums'] }}>{vnd(task.unitPriceVndPerMinute)}</Text>
        <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{tt('hall.perMinute')}</Text>
      </View>
    </>}
  </PhantomPressable>;
}
