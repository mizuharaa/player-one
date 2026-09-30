import { Image, View } from 'react-native';
import { mascotStateAt, type MascotState } from '@playerone/design/tokens';
import { PhantomPressable } from '../ui/PhantomPressable.tsx';
import camera from '../../assets/illustrations/panda-claim-success.png';
import wave from '../../assets/illustrations/panda-wave.png';
import review from '../../assets/illustrations/panda-review-flat.png';
import rest from '../../assets/illustrations/panda-rest.png';

const artwork = { camera, wave, review, rest };
export type Pose = 'idle' | 'point' | keyof typeof artwork;

export function Panda({ size = 96, pose = 'idle', state, onPress, label }: {
  size?: number; pose?: Pose; state?: MascotState; onPress?: () => void; label?: string;
}) {
  const shift = state ?? mascotStateAt();
  const selected = pose === 'point' ? 'wave' : pose === 'idle' ? (shift === 'earlyBird' ? 'wave' : shift === 'dayShift' ? 'camera' : 'rest') : pose;
  const picture = <Image source={artwork[selected]} style={{ width: size, height: size }} resizeMode="contain"
    accessible={Boolean(label) && !onPress} accessibilityLabel={onPress ? undefined : label} />;
  return onPress ? <PhantomPressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress}>{picture}</PhantomPressable> : picture;
}

export function PandaPointer({ x, y, size = 72, flip = false }: { x: number; y: number; size?: number; flip?: boolean }) {
  return <View pointerEvents="none" importantForAccessibility="no-hide-descendants"
    style={{ position: 'absolute', left: x, top: y, transform: [{ scaleX: flip ? -1 : 1 }] }}><Panda size={size} pose="point" /></View>;
}
