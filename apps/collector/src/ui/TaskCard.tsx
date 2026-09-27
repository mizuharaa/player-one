import { TaskPhotoLabel } from './TaskPhotoLabel.tsx';
import { taskDuration } from '../duration.ts';
import { Text, View, useWindowDimensions } from 'react-native';
import { Icon } from './Icon.tsx';
import { LinearGradient } from 'expo-linear-gradient';
import { Image, type ImageSource } from 'expo-image';
import type { Task } from '../api/types.ts';
import { useT } from '../locale.tsx';
import { vnd, dong } from '../money.ts';
import { useTheme } from '../theme.tsx';
import { face } from '../ui.tsx';
import { PhantomPressable } from './PhantomPressable.tsx';
import { taskImage, taskImageLabel } from './taskImage.ts';

/** Luma rows for comparison; Shop photo tiles for a browsable rail. Same task and action. */
export function TaskCard({ task, onPress, hint, variant = 'row', status }: {
  task: Task; onPress: () => void; hint?: string; variant?: 'row' | 'tile' | 'compact' | 'featured'; status?: string;
}) {
  const theme = useTheme(), tt = useT(), c = theme.collector;
  const { fontScale, width } = useWindowDimensions();
  const tile = variant === 'tile';
  const imageLabel = taskImageLabel(task);
  if (variant === 'featured') return <PhantomPressable accessibilityRole="button" accessibilityLabel={task.title}
    accessibilityHint={`${tt('explore.openTask')}. ${tt(imageLabel)}`} onPress={onPress}
    style={{ minHeight: 124 * fontScale, aspectRatio: fontScale > 1.3 ? undefined : 2.9, padding: 12, gap: 8, justifyContent: 'space-between', borderRadius: 16, overflow: 'hidden', backgroundColor: c.glow }}>
    <Image source={taskImage(task) as unknown as ImageSource} contentFit="cover" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }} accessible={false} />
    <LinearGradient pointerEvents="none" colors={['transparent', c.night]} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '80%' }} />
    <View style={{ alignSelf: 'flex-end', maxWidth: '90%', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: c.paper }}><Text style={{ ...c.type.caption, fontFamily: face(theme), color: c.ink }}>{tt(imageLabel)}</Text></View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text numberOfLines={fontScale > 1.3 ? undefined : 2} style={{ ...c.type.h2, fontWeight: '700', color: c.surface, fontFamily: face(theme), flex: 1 }}>{task.title}</Text><Icon name="chevronRight" color={c.surface} />
    </View>
  </PhantomPressable>;
  if (variant === 'compact') {
    const trailing = width >= 390 && fontScale <= 1.3;
    const statusPill = status ? <View style={{ borderRadius: 10, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: c.sun, maxWidth: trailing ? 108 : undefined }}><Text style={{ fontSize: 11, lineHeight: 16, color: c.plum, fontFamily: face(theme) }}>{status}</Text></View> : null;
    return <PhantomPressable accessibilityRole="button" accessibilityLabel={[task.title, status, tt(imageLabel)].filter(Boolean).join('. ')} accessibilityHint={hint ?? tt('explore.openTask')} onPress={onPress}
      style={{ paddingVertical: 12, gap: 10, flexDirection: fontScale > 1.6 ? 'column' : 'row', alignItems: 'center', borderBottomWidth: 1, borderColor: c.line }}>
      <Image source={taskImage(task) as unknown as ImageSource} contentFit="cover" accessible={false} style={{ width: 60, height: 64, borderRadius: 14, backgroundColor: c.glow }} />
      <View style={{ flex: 1, gap: 3, minWidth: 0 }}>
        <Text numberOfLines={fontScale > 1.3 ? undefined : 2} style={{ fontSize: 16, lineHeight: 22, fontWeight: '700', color: c.ink, fontFamily: face(theme) }}>{task.title}</Text>
        <Text style={{ fontSize: 12, lineHeight: 18, color: c.plum, fontFamily: face(theme), fontWeight: '600' }}>{dong(task.unitPriceVndPerMinute)} <Text style={{ color: c.muted, fontWeight: '400' }}>{tt('taskCard.rateUnit')}</Text></Text>
        <Text style={{ fontSize: 11, lineHeight: 15, color: c.muted, fontFamily: face(theme) }}>{tt(imageLabel)}</Text>
        {!trailing ? <View style={{ alignItems: 'flex-start' }}>{statusPill}</View> : null}
      </View>{trailing ? statusPill : null}<Icon name="chevronRight" size={18} color={c.muted} />
    </PhantomPressable>;
  }
  const type = task.scenario ?? task.type;
  const badge = type === 'home' || type === 'kitchen' ? 'taskCard.home' : type === 'office' ? 'scenario.office' : type === 'shop' ? 'scenario.shop' : type === 'warehouse' ? 'taskCard.warehouse' : 'taskCard.default';
  return <PhantomPressable pressedScale={.975} accessibilityRole="button" accessibilityLabel={task.title}
    accessibilityHint={`${hint ?? tt('explore.openTask')}. ${tt(imageLabel)}`} onPress={onPress}
    style={{ width: tile ? 236 : undefined, gap: tile ? 12 : 14, paddingVertical: tile ? 0 : 12,
      borderBottomWidth: tile ? 0 : 1, borderBottomColor: c.line,
      flexDirection: tile || fontScale > 1.6 ? 'column' : 'row', alignItems: tile ? 'stretch' : 'flex-start' }}>
    <View style={{ width: tile || fontScale > 1.6 ? '100%' : 88, height: tile ? 204 : 104, borderRadius: tile ? 28 : 20, overflow: 'hidden', backgroundColor: c.glow }}>
      <Image source={taskImage(task) as unknown as ImageSource} contentFit="cover" style={{ width: '100%', height: '100%' }} accessible={false} />
      {tile ? <TaskPhotoLabel label={imageLabel} /> : null}
      <View style={{ position: 'absolute', left: 8, top: 8, backgroundColor: c.surface, borderRadius: c.radius.pill, paddingHorizontal: 8, paddingVertical: 4 }}>
        <Icon name={task.claimedByMe ? 'circleCheck' : task.claimable ? 'arrowUpRight' : 'clock'} size={16} color={c.ink} />
      </View>
    </View>
    <View style={{ flex: tile ? undefined : 1, gap: 5, minWidth: 0 }}>
      <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{tt(badge)}{tile ? '' : ` · ${tt(imageLabel)}`}</Text>
      <Text numberOfLines={fontScale > 1.3 ? undefined : 2} style={{ fontSize: tile ? 20 : 18, lineHeight: tile ? 27 : 24, fontWeight: '600', color: c.ink, fontFamily: face(theme) }}>{task.title}</Text>
      <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{tt('taskCard.target').replace('{duration}', taskDuration(task.targetMinutes, tt))}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 5 }}>
        <Text testID="task-price" style={{ ...c.type.body, color: c.ink, fontFamily: face(theme), fontWeight: '700', fontVariant: ['tabular-nums'] }}>{vnd(task.unitPriceVndPerMinute)}</Text>
        <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme) }}>{tt('hall.perMinute')}</Text>
      </View>
      <Text style={{ ...c.type.caption, color: task.claimable ? c.plum : c.muted, fontFamily: face(theme) }}>{task.claimedByMe ? tt('detail.claimed') : tt('taskCard.slots').replace('{count}', String(task.remainingSlots))}</Text>
    </View>
  </PhantomPressable>;
}
