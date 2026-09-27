import { Text, View } from 'react-native';
import { useT } from '../locale.tsx';
import { polish, useTheme } from '../theme.tsx';
import { face } from '../ui.tsx';

/** Illustrations and stock images are not the actual collection venue. */
export function TaskPhotoLabel({ label = 'hall.imageLabel' }: { label?: 'hall.imageLabel' | 'hall.aiImageLabel' }) {
  const theme = useTheme(), tt = useT(), c = theme.collector;
  return <View testID="task-photo-label" pointerEvents="none" style={{ position: 'absolute', right: theme.space[2], bottom: theme.space[2], maxWidth: '90%', backgroundColor: polish.badge, borderRadius: c.radius.pill, paddingVertical: theme.space[1], paddingHorizontal: theme.space[2] }}>
    <Text style={{ ...c.type.caption, color: c.ink, fontFamily: face(theme) }}>{tt(label)}</Text>
  </View>;
}
