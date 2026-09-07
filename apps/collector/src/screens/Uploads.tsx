import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EpisodeState } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import type { NativeTheme } from '@playerone/design/native';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Body, Button, Card, Hatch, ListScreen, Note, Row, Tag, Title, face } from '../ui.tsx';

/**
 * APP-23/24: every episode and its state. APP-25: the upload starts from an
 * explicit, in-your-face confirmation and from nowhere else. There is no
 * "upload all", no auto-retry that starts a fresh upload, and no effect that
 * fires on network state. The collector decides what leaves their phone.
 *
 * APP-27: a failed review carries the server's own Vietnamese reason, on the
 * row it belongs to. It is never summarised, never translated here, and never
 * replaced with a generic sentence — a collector who was not paid for an
 * episode is owed the actual reason.
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
      // `techInk`, for the same reason `Note` uses it: `tech[100]` inverts in
      // dark mode and `tech[700]` does not, which measured 1.35:1.
      return { fg: theme.color.techInk, bg: theme.color.tech[100] };
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
  const listTarget = useGuideTarget('uploads.list');

  const episodes = useQuery({ queryKey: ['episodes'], queryFn: () => api.episodes() });

  const confirm = useMutation({
    mutationFn: (episodeId: string) => api.confirmUpload(episodeId),
    onSuccess: async () => {
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: ['episodes'] });
    },
  });

  return (
    <ListScreen
      title={tt('uploads.title')}
      data={episodes.data ?? []}
      keyOf={(episode) => episode.episodeId}
      header={
        <View ref={listTarget} collapsable={false}>
          <Note text={tt('uploads.confirmBody')} />
        </View>
      }
      empty={
        episodes.isError ? (
          <Note text={tt('common.loadFailed')} />
        ) : episodes.data === undefined ? (
          <Body muted>{tt('common.loading')}</Body>
        ) : (
          <Hatch text={tt('uploads.empty')} />
        )
      }
      renderItem={(episode) => {
        const colors = stateColors(theme, episode.state);
        const open = confirming === episode.episodeId;
        return (
          <Card>
            <Title>{episode.episodeId}</Title>
            <Tag label={tt(`state.${episode.state}`)} fg={colors.fg} bg={colors.bg} />
            <Row label={tt('uploads.size')} value={gb(episode.sizeBytes)} />
            {episode.sessionId === '' ? null : (
              <Row label={tt('uploads.session')} value={episode.sessionId} />
            )}
            {/* APP-27. It stays on the row, beside the state that caused it.
                Stacked and not a `Row`: the reason is a sentence the reviewer
                wrote, and a label/value line squeezed "Lý do" onto two lines to
                make room for it. A reason a collector was not paid on is read,
                not scanned down a column. */}
            {episode.rejectReason !== undefined ? (
              <View
                style={{
                  backgroundColor: theme.color.verdict.reject.bg,
                  borderRadius: theme.radius.sm,
                  padding: theme.space[3],
                  gap: theme.space[1],
                }}
              >
                <Text
                  style={{
                    color: theme.color.verdict.reject.fg,
                    fontFamily: face(theme),
                    fontSize: theme.fontSize.xs,
                    fontWeight: theme.fontWeight.semibold,
                  }}
                >
                  {tt('uploads.reason')}
                </Text>
                <Text
                  style={{
                    color: theme.color.foreground,
                    fontFamily: face(theme),
                    fontSize: theme.fontSize.sm,
                    lineHeight: theme.fontSize.sm * 1.5,
                  }}
                >
                  {episode.rejectReason}
                </Text>
              </View>
            ) : null}
            {/* The row's control opens the confirmation; the sun primary is
                inside it. A filled primary on every pending row put three of
                them in one viewport, each looking like the commitment when
                none of them is one — and the system allows one glowing element
                per screen. APP-25's actual upload button is below. */}
            {episode.state === 'pending_upload' && !open ? (
              <Button
                variant="secondary"
                label={tt('uploads.upload')}
                onPress={() => setConfirming(episode.episodeId)}
              />
            ) : null}
            {open ? (
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.color.border,
                  paddingTop: theme.space[3],
                  gap: theme.space[2],
                }}
              >
                {/* The sentence is not repeated here. It is the standing
                    Note at the top of the screen, live-regioned and always on
                    screen, and printing it again three rows below itself read
                    as a rendering fault rather than as emphasis. The panel
                    opens inside the episode's own card, under its id, size and
                    session, so what is being confirmed is already named. */}
                <Title>{tt('uploads.confirmTitle')}</Title>
                {/* The real client refuses this today (`upload_not_supported`)
                    and the refusal is shown rather than swallowed. Never
                    simulate a success the platform did not give. */}
                {confirm.isError ? <Note text={tt('common.actionFailed')} /> : null}
                <Button
                  label={tt('uploads.upload')}
                  disabled={confirm.isPending}
                  onPress={() => confirm.mutate(episode.episodeId)}
                />
                <Button
                  label={tt('common.cancel')}
                  variant="ghost"
                  onPress={() => setConfirming(null)}
                />
              </View>
            ) : null}
          </Card>
        );
      }}
    />
  );
}
