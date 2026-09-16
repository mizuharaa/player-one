import { useState } from 'react';
import { View } from 'react-native';
import { ApiError } from '../api/types.ts';
import { useT } from '../locale.tsx';
import { Body, Button, Title } from '../ui.tsx';
import { EmptyTasks, ErrorMark } from './illustrations/index.tsx';
import { ServerSettings } from './ServerSettings.tsx';

export function StatePanel({ title, text, action, onPress, error = false, busy = false }: {
  title: string; text: string; action?: string; onPress?: () => void; error?: boolean; busy?: boolean;
}) {
  return <View accessibilityLiveRegion="polite" style={{ backgroundColor: '#F6F2EA', borderRadius: 20, padding: 24, gap: 16, alignItems: 'center' }}>
    {error ? <ErrorMark size={104} /> : <EmptyTasks size={104} />}
    <Title>{title}</Title><Body muted>{text}</Body>
    {action && onPress ? <Button label={action} onPress={onPress} busy={busy} variant="secondary" /> : null}
  </View>;
}

export function Failure({ error, text, onRetry, onServerClose, busy = false }: { error?: unknown; text: string; onRetry?: () => void; onServerClose?: () => void; busy?: boolean; tone?: string }) {
  const tt = useT();
  const [server, setServer] = useState(false);
  const sentence = error instanceof Error && 'sentence' in error && typeof error.sentence === 'string' ? error.sentence : text;
  const offline = error instanceof ApiError && error.code === 'server_unreachable';
  return <>
    <StatePanel error title={tt(offline ? 'state.offline' : 'common.actionFailed')}
      text={offline ? tt('state.offlineBody') : sentence}
      action={offline ? tt('server.title') : onRetry ? tt('common.retry') : undefined}
      onPress={offline ? () => setServer(true) : onRetry} busy={busy} />
    {server ? <ServerSettings onClose={() => { setServer(false); onServerClose?.(); }} /> : null}
  </>;
}
