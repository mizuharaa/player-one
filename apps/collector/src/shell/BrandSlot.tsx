import { polish } from '../theme.tsx';
import { useRef } from 'react';
import { Text, View } from 'react-native';

export let brandFrame: { x: number; y: number; width: number; height: number } | null = null;
export function BrandSlot({ color = polish.ink, measure = true }: { color?: string; measure?: boolean }) {
  const ref = useRef<View>(null);
  return <View ref={ref} collapsable={false} style={{ alignSelf: 'flex-start' }} testID="brand-slot" {...{ dataSet: { brand: true } }}
    onLayout={() => measure && ref.current?.measureInWindow((x, y, width, height) => { brandFrame = { x, y, width, height }; })}>
    <Text style={{ fontFamily: 'Be Vietnam Pro', fontSize: 30, lineHeight: 38, fontWeight: '600', letterSpacing: -1.2, color }}>PlayerOne</Text>
  </View>;
}
