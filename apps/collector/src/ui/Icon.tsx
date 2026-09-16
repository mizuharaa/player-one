import { ArrowDown, ArrowLeft, ArrowUp, ArrowUpRight, Bell, Camera, Check, ChevronRight, CircleCheck, CircleHelp, Clock, FileText, House, Info, LayoutGrid, ListChecks, MessageCircle, Plus, Search, Settings, ShieldCheck, Upload, UserRound, Wallet, X, type LucideIcon } from 'lucide-react-native';

const icons = { arrowDown: ArrowDown, arrowLeft: ArrowLeft, arrowUp: ArrowUp, arrowUpRight: ArrowUpRight, bell: Bell, camera: Camera, check: Check, chevronRight: ChevronRight, circleCheck: CircleCheck, help: CircleHelp, clock: Clock, file: FileText, home: House, info: Info, grid: LayoutGrid, tasks: ListChecks, chat: MessageCircle, plus: Plus, search: Search, settings: Settings, shield: ShieldCheck, upload: Upload, profile: UserRound, wallet: Wallet, close: X } satisfies Record<string, LucideIcon>;
export type IconName = keyof typeof icons;

/** Lucide's ISC-licensed vectors; no emoji or approximated View-built glyphs. */
export function Icon({ name, size = 22, color, strokeWidth = 1.8 }: { name: IconName; size?: number; color: string; strokeWidth?: number }) {
  const Glyph = icons[name];
  return <Glyph size={size} color={color} strokeWidth={strokeWidth} accessible={false} />;
}
