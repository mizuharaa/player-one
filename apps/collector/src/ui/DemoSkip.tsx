import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { BUILD_PROFILE } from '../api/config.ts';
import type { DemoStep } from '../api/types.ts';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';

/** Navigation only: the server acknowledges its audit before the caller advances. */
export function DemoSkip({ from, to, onSkipped, disabled = false }: {
  from: DemoStep; to: DemoStep; onSkipped: () => void; disabled?: boolean;
}) {
  const api = useApi(), tt = useT(), theme = useTheme();
  const context = useQuery({ queryKey: ['demoContext'], queryFn: () => api.demoContext(), enabled: BUILD_PROFILE !== 'play', retry: false });
  const [busy, setBusy] = useState(false), [failed, setFailed] = useState(false);
  const sending = useRef(false), mounted = useRef(false);
  const destination = useRef({ from, to, disabled });
  destination.current = { from, to, disabled };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  if (BUILD_PROFILE === 'play' || !context.data?.runId) return null;
  const skip = async () => {
    if (sending.current || disabled) return;
    sending.current = true; setBusy(true); setFailed(false);
    try {
      await api.skipDemoStep(from, to);
      if (mounted.current && !destination.current.disabled && destination.current.from === from && destination.current.to === to) onSkipped();
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      sending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <View style={{ flexShrink: 1, gap: theme.space[1] }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${tt('onboarding.skip')} · ${tt('demo.title')}`}
      accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={() => void skip()}
      style={({ pressed }) => ({ minHeight: 48, minWidth: 48, justifyContent: 'center', paddingHorizontal: theme.space[2], opacity: disabled || busy || pressed ? .6 : 1 })}>
      <Text style={{ ...theme.collector.type.body, color: theme.collector.plum, fontFamily: theme.font.sans }}>
        {tt(busy ? 'common.saving' : failed ? 'common.retry' : 'onboarding.skip')} · {tt('demo.title')}
      </Text>
    </Pressable>
    {failed ? <Text accessibilityRole="alert" style={{ ...theme.collector.type.caption, color: theme.collector.redInk }}>{tt('common.actionFailed')}</Text> : null}
  </View>;
}
