import { paperCard } from './CardSheen.tsx';
import { useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '../api/types.ts';
import { useT } from '../locale.tsx';
import { Body, Button, Title } from '../ui.tsx';
import { EmptyTasks, ErrorMark } from './illustrations/index.tsx';
import { ServerSettings } from './ServerSettings.tsx';

export function StatePanel({ title, text, action, onPress, secondaryAction, onSecondary, error = false, busy = false }: {
  title: string; text?: string; action?: string; onPress?: () => void; error?: boolean; busy?: boolean; secondaryAction?: string; onSecondary?: () => void;
}) {
  return <View accessibilityLiveRegion="polite" style={{ ...paperCard, padding: 24, gap: 16, alignItems: 'center' }}>
    {error ? <ErrorMark size={104} /> : <EmptyTasks size={104} />}
    <Title>{title}</Title>{text ? <Body muted>{text}</Body> : null}
    {action && onPress ? <Button label={action} onPress={onPress} busy={busy} variant={error ? 'primary' : 'secondary'} /> : null}
    {secondaryAction && onSecondary ? <Button label={secondaryAction} onPress={onSecondary} variant="ghost" /> : null}
  </View>;
}

export function Failure({ error, text, onRetry, busy = false }: { error?: unknown; text: string; onRetry?: () => void; busy?: boolean }) {
  const tt = useT();
  const [server, setServer] = useState(false);
  const sentence = error instanceof Error && 'sentence' in error && typeof error.sentence === 'string' ? error.sentence : text;
  const offline = error instanceof ApiError && error.code === 'server_unreachable';
  return <>
    <StatePanel error title={offline ? tt('state.offline') : text}
      text={offline ? tt('state.offlineBody') : sentence === text ? undefined : sentence}
      action={onRetry ? tt('common.retry') : undefined}
      secondaryAction={offline ? tt('server.title') : undefined} onSecondary={() => setServer(true)}
      onPress={onRetry} busy={busy} />
    {server ? <ServerSettings onClose={() => setServer(false)} /> : null}
  </>;
}
