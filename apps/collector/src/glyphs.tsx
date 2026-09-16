import { View } from 'react-native';
import { useTheme } from './theme.tsx';
import { Icon } from './ui/Icon.tsx';
import { Play } from 'lucide-react-native';

type Props = { size?: number; color: string };
export const GlyphHome = (props: Props) => <Icon name="home" {...props} />;
export const GlyphTasks = (props: Props) => <Icon name="tasks" {...props} />;
export const GlyphSession = (props: Props) => <Icon name="camera" {...props} />;
export const GlyphUploads = (props: Props) => <Icon name="upload" {...props} />;
export const GlyphForum = (props: Props) => <Icon name="chat" {...props} />;
export const GlyphPlus = (props: Props) => <Icon name="plus" {...props} />;
export const GlyphIncome = (props: Props) => <Icon name="wallet" {...props} />;
export const GlyphPlay = ({ size = 28, color }: Props) => <Play size={size} color={color} fill={color} accessible={false} />;
export function Rule() {
  const theme = useTheme();
  return <View style={{ height: 1, backgroundColor: theme.color.border }} />;
}
