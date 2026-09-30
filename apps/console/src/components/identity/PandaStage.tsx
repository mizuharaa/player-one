import { Panda } from './Panda.tsx';
import './panda.css';

export type PandaMood = 'idle' | 'happy' | 'thinking' | 'pointing';

/** The approved illustrated guide. No rendering loop or WebGL download. */
export function PandaStage({ mood = 'idle', size = 112, className = '', label, onPress, paused = false }: {
  mood?: PandaMood; size?: number; className?: string; label?: string; onPress?: () => void; paused?: boolean;
}) {
  // Keep decorative characters away from footage decisions, including direct route loads.
  if (typeof window !== 'undefined' && window.location.pathname.startsWith('/review')) return null;
  const picture = <Panda size={size} pose={mood === 'thinking' ? 'review' : mood === 'happy' ? 'camera' : 'wave'} label={onPress ? undefined : label} />;
  return onPress
    ? <button type="button" className={`panda-stage ${className}`} data-paused={paused} aria-label={label} onClick={onPress}>{picture}</button>
    : <div className={`panda-stage ${className}`} data-paused={paused} style={{ pointerEvents: 'none' }}>{picture}</div>;
}
export default PandaStage;
