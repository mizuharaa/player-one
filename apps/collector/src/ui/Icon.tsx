import { polish } from '../theme.tsx';
import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, Bell, Camera, Check, ChevronRight, CircleCheck, CircleHelp, Clock, FileText, House, Info, Languages, LayoutGrid, ListChecks, MessageCircle, Plus, Search, Settings, ShieldCheck, Upload, UserRound, Video, Wallet, X, type LucideIcon } from 'lucide-react-native';

const icons = { arrowDown: ArrowDown, arrowLeft: ArrowLeft, arrowUp: ArrowUp, arrowUpRight: ArrowUpRight, bell: Bell, camera: Camera, video: Video, check: Check, chevronRight: ChevronRight, circleCheck: CircleCheck, help: CircleHelp, clock: Clock, file: FileText, home: House, info: Info, grid: LayoutGrid, tasks: ListChecks, language: Languages, chat: MessageCircle, plus: Plus, search: Search, settings: Settings, shield: ShieldCheck, upload: Upload, profile: UserRound, wallet: Wallet, close: X } satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof icons;

/** Lucide's ISC-licensed vectors; no emoji or approximated View-built glyphs. */
export function Icon({ name, size = 22, color, strokeWidth = 1.8, fill = 'none' }: { name: IconName; size?: number; color: string; strokeWidth?: number; fill?: string }) {
  const Glyph = icons[name];
  return <Glyph size={size} color={color} strokeWidth={strokeWidth} fill={fill} accessible={false} />;
}

/** Colored library vectors, kept unboxed so every row does not acquire another container. */
export function FeatureIcon({ name, size = 26 }: { name: IconName; size?: number }) {
  const fill = name === 'bell' ? polish.notificationYellow
    : ['camera', 'wallet', 'help'].includes(name) ? polish.feature.peach
    : ['shield', 'tasks'].includes(name) ? polish.feature.mint
    : ['file', 'video'].includes(name) ? polish.feature.blue : polish.feature.lilac;
  return <Icon name={name} size={size} color={name === 'language' ? polish.art.violet : polish.ink} fill={name === 'language' ? 'none' : fill} strokeWidth={1.65} />;
}
