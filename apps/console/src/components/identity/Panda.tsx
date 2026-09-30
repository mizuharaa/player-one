import { mascotStateAt, type MascotState } from '@playerone/design/tokens';
import camera from '../../assets/mascot/panda-claim-success.png';
import wave from '../../assets/mascot/panda-wave.png';
import review from '../../assets/mascot/panda-review-flat.png';
import rest from '../../assets/mascot/panda-rest.png';
import avatar from '../../assets/mascot/panda-avatar-flat.png';

export const MASCOT_LABEL: Record<MascotState, { en: string; zh: string; hours: string }> = {
  earlyBird: { en: 'Early bird', zh: '早班', hours: '05:00 – 09:00' },
  dayShift: { en: 'Day shift', zh: '白班', hours: '09:00 – 17:00' },
  goldenHour: { en: 'Golden hour', zh: '黄昏', hours: '17:00 – 22:00' },
  nightOwl: { en: 'Night owl', zh: '夜猫子', hours: '22:00 – 05:00' },
};
const artwork = { camera, wave, review, rest, avatar };
export function Panda({ state, pose, size = 96, className, label }: {
  state?: MascotState; pose?: keyof typeof artwork; size?: number; className?: string; label?: string;
}) {
  const shift = state ?? mascotStateAt();
  const selected = pose ?? (size <= 48 ? 'avatar' : shift === 'earlyBird' ? 'wave' : shift === 'dayShift' ? 'camera' : 'rest');
  return <img src={artwork[selected]} width={size} height={size} className={className} alt={label ?? ''}
    aria-hidden={label ? undefined : true} draggable={false} decoding="async"
    style={{ display: 'block', objectFit: 'contain', flexShrink: 0 }} />;
}
export { mascotStateAt };
export type { MascotState };
