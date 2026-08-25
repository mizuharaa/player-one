import { useState } from 'react';
import { View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EpisodeState } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import type { NativeTheme } from '@playerone/design/native';
import { Body, Button, Card, Note, Row, Screen, Tag, Title } from '../ui.tsx';

/**
 * APP-23/24: every episode and its state. APP-25: the upload starts from an
 * explicit, in-your-face confirmation and from nowhere else. There is no
 * "upload all", no auto-retry that starts a fresh upload, no effect that
 * fires on network state. The collector decides what leaves their phone.
 */
const stateColors = (theme: NativeTheme, state: EpisodeState): { fg: string; bg: string } => {
  switch (state) {
    case 'review_passed':
      return theme.color.verdict.pass;
    case 'review_failed':
      return theme.color.verdict.reject;
    case 'under_review':
      return theme.color.verdict.partial;
    case 'uploading':
    case 'uploaded':
      return { fg: theme.color.tech[700], bg: theme.color.tech[100] };
    case 'pending_upload':
      return { fg: theme.color.mutedForeground, bg: theme.color.muted };
  }
};

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

export function Uploads() {
  const api = useApi();
  const tt = useT();
  const theme = useTheme();
  const queryClient = useQueryClient();
  /** The episode whose confirmation step is open. One at a time, on purpose. */
  const [confirming, setConfirming] = useState<string | null>(null);

  const episodes = useQuery({ queryKey: ['episodes'], queryFn: () => api.episodes() });

  const confirm = useMutation({
    mutationFn: (episodeId: string) => api.confirmUpload(episodeId),
    onSuccess: async () => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: ['episodes'] });
    },
  });

  return (
    <Screen title={tt('uploads.title')}>
      <Note text={tt('uploads.confirmBody')} />
      {episodes.data !== undefined && episodes.data.length === 0 ? (
        <Body muted>{tt('uploads.empty')}</Body>
      ) : null}
      {(episodes.data ?? []).map((episode) => {
        const colors = stateColors(theme, episode.state);
        return (
          <Card key={episode.episodeId}>
            <Title>{episode.episodeId}</Title>
            <Row label={tt('uploads.size')} value={gb(episode.sizeBytes)} />
            <Tag label={tt(`state.${episode.state}`)} fg={colors.fg} bg={colors.bg} />
            {episode.rejectReason !== undefined ? (
              <Row label={tt('uploads.reason')} value={episode.rejectReason} />
            ) : null}
            {episode.state === 'pending_upload' && confirming !== episode.episodeId ? (
              <Button label={tt('uploads.upload')} onPress={() => setConfirming(episode.episodeId)} />
            ) : null}
            {confirming === episode.episodeId ? (
              <View style={{ gap: theme.space[2] }}>
                <Title>{tt('uploads.confirmTitle')}</Title>
                <Body muted>{tt('uploads.confirmBody')}</Body>
                <Button label={tt('uploads.upload')} onPress={() => confirm.mutate(episode.episodeId)} />
                <Button label={tt('common.cancel')} kind="ghost" onPress={() => setConfirming(null)} />
              </View>
            ) : null}
          </Card>
        );
      })}
    </Screen>
  );
}
