import { type ReactNode } from 'react';
import { View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Ellipse, G, Path, Rect } from 'react-native-svg';
import { polish } from '../../theme.tsx';

/** Authored vector objects: film for Sessions, a receipt for Income, a pass for Profile.
 * Decorative only. These are not photos of the camera, payment cards or earned badges. */
function ObjectFrame({ size, children }: { size: number; children: ReactNode }) {
  const { width, fontScale } = useWindowDimensions();
  const side = Math.min(size, width < 360 || fontScale > 1.2 ? 64 : 88);
  return <View pointerEvents="none" aria-hidden accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: side, height: side, flexShrink: 0 }}>
    <Svg width={side} height={side} viewBox="0 0 160 160" accessible={false}>{children}</Svg>
  </View>;
}

/** A stack of film frames with an upload arrow; no fabricated completion tick. */
export function SessionArtwork({ size = 132 }: { size?: number }) {
  const a = polish.art;
  return <ObjectFrame size={size}><>
    <Ellipse cx="81" cy="143" rx="48" ry="6" fill={a.deep} opacity=".07" />
    <G transform="rotate(14 91 65)">
      <Rect x="51" y="15" width="86" height="93" rx="15" fill={a.cream} stroke={a.white} strokeWidth="1.5" />
      <Rect x="59" y="23" width="70" height="77" rx="9" fill="none" stroke={a.violet} strokeOpacity=".18" />
      <Path d="M67 34h23m-23 6h14" stroke={a.white} strokeWidth="3" strokeLinecap="round" />
    </G>
    <G transform="rotate(-10 69 88)">
      <Rect x="19" y="44" width="96" height="88" rx="16" fill={a.deep} opacity=".13" transform="translate(0 4)" />
      <Rect x="19" y="40" width="96" height="88" rx="16" fill={a.deep} stroke={a.lilac} strokeWidth="1" />
      <Rect x="32" y="57" width="70" height="51" rx="8" fill={a.deep} />
      <Rect x="35" y="60" width="64" height="45" rx="6" fill={a.cream} />
      <Path d="m60 70 20 12-20 12Z" fill={a.white} />
      {[32,48,64,80,96].map(x => <G key={x}><Rect x={x} y="47" width="6" height="4" rx="1" fill={a.lilac} /><Rect x={x} y="116" width="6" height="4" rx="1" fill={a.lilac} /></G>)}
      <Path d="M24 57V54a9 9 0 0 1 9-9" stroke={a.white} strokeOpacity=".7" fill="none" strokeLinecap="round" />
    </G>
    <Circle cx="122" cy="116" r="23" fill={a.deep} opacity=".1" />
    <Circle cx="122" cy="112" r="23" fill={a.orange} stroke={a.white} strokeWidth="1.5" />
    <Path d="M122 123V100m-9 9 9-9 9 9" stroke={a.deep} strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    <Circle cx="23" cy="24" r="5" fill={a.orange} /><Circle cx="140" cy="61" r="3" fill={a.violet} />
  </></ObjectFrame>;
}

/** A folded statement and ledger, deliberately without currency or payment-success marks. */
export function EarningsArtwork({ size = 128 }: { size?: number }) {
  const a = polish.art;
  return <ObjectFrame size={size}><>
    <Ellipse cx="83" cy="143" rx="51" ry="6" fill={a.deep} opacity=".07" />
    <G transform="rotate(-13 74 90)">
      <Rect x="22" y="45" width="103" height="88" rx="18" fill={a.deep} stroke={a.lilac} />
      <Path d="M29 56c0-4 3-7 7-7h73" stroke={a.white} strokeOpacity=".5" fill="none" strokeLinecap="round" />
    </G>
    <G transform="rotate(9 86 67)">
      <Path d="M48 15h61l16 17v77l-8-5-8 5-8-5-8 5-8-5-8 5-8-5-8 5-8-5-5 4Z" fill={a.white} stroke={a.lilac} strokeWidth="1" />
      <Path d="M109 15v17h16" fill={a.lilac} opacity=".55" />
      <Rect x="60" y="33" width="27" height="7" rx="3.5" fill={a.violet} />
      <Path d="M60 51h42M60 61h27m8 0h9M60 72h20m10 0h14" stroke={a.deep} strokeOpacity=".26" strokeWidth="3" strokeLinecap="round" />
      <Path d="M60 84h44" stroke={a.lilac} strokeDasharray="3 3" />
      <Rect x="89" y="91" width="15" height="5" rx="2.5" fill={a.orange} />
    </G>
    <G transform="rotate(-7 78 117)">
      <Path d="M25 94h72c10 0 14 7 14 16v21c0 7-5 11-11 11H40c-9 0-15-6-15-15Z" fill={a.cream} stroke={a.white} strokeWidth="1.5" />
      <Path d="M31 101h58" stroke={a.white} strokeWidth="2" strokeLinecap="round" />
      <Rect x="90" y="108" width="28" height="20" rx="7" fill={a.deep} /><Circle cx="100" cy="118" r="3" fill={a.cream} />
      <Path d="M40 127h18m5 0h8" stroke={a.violet} strokeWidth="3" strokeLinecap="round" />
    </G>
    <Circle cx="136" cy="52" r="7" fill={a.orange} stroke={a.white} /><Circle cx="20" cy="32" r="3" fill={a.violet} />
  </></ObjectFrame>;
}

/** A personal collector pass, not a membership tier or verified credential. */
export function CollectorPassArtwork({ size = 92 }: { size?: number }) {
  const a = polish.art;
  return <ObjectFrame size={size}><>
    <Ellipse cx="79" cy="144" rx="44" ry="5" fill={a.deep} opacity=".07" />
    <Path d="M63 34V22c0-14 35-14 35 0v17" stroke={a.violet} strokeWidth="9" fill="none" />
    <Path d="M64 34V22c0-12 32-12 32 0" stroke={a.lilac} strokeWidth="3" fill="none" />
    <G transform="rotate(10 81 84)">
      <Rect x="32" y="37" width="99" height="101" rx="18" fill={a.deep} opacity=".25" />
      <Rect x="25" y="31" width="99" height="101" rx="18" fill={a.cream} stroke={a.white} strokeWidth="1.5" />
      <Rect x="58" y="40" width="32" height="6" rx="3" fill={a.deep} opacity=".6" />
      <Circle cx="57" cy="77" r="17" fill={a.deep} /><Circle cx="57" cy="72" r="6" fill={a.white} />
      <Path d="M45 87c1-12 23-12 24 0" fill={a.white} />
      <Path d="M84 66h22m-22 9h16m-16 9h20" stroke={a.deep} strokeOpacity=".4" strokeWidth="3" strokeLinecap="round" />
      {[40,45,52,57,63,70,75,80].map((x,i) => <Rect key={x} x={x} y="108" width={i%3===0?3:1.5} height="9" rx=".5" fill={a.deep} opacity=".6" />)}
      <Circle cx="103" cy="109" r="8" fill={a.orange} />
    </G>
  </></ObjectFrame>;
}
