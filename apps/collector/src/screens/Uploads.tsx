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
      /*
       * Not `partial`. A partial pass is an outcome a collector is paid on,
       * and "somebody is looking at it" is not an outcome at all — wearing
       * that violet said the episode had already been half judged.
       *
       * `warn`, which is the token for exactly this: a human has it and no
       * outcome is recorded yet. It was `tech[50]`, and tech is PaXini's mark
       * now rather than a system colour. The console reached the same place
       * from the other side — its risk band `review` and its `pending_zlp`
       * attempt are both `--warn-bg`/`--warn` — so an episode waiting on a
       * reviewer and a payment waiting on a gateway read alike, which is what
       * they are. It is not one of the three verdict hues and cannot be
       * mistaken for one.
       */
      return { fg: theme.color.warn, bg: theme.color.warnBg };
    case 'uploading':
    case 'uploaded':
      /*
       * The ink pill: the episode has left the phone, or is leaving it. This
       * is the console's `succeeded` and `hold` mark — `--foreground` on
       * `--background` — and it is the one non-verdict tone in the system
       * that reads as a settled machine state without borrowing a hue that
       * means something about money. It was `tech[100]`.
       */
      return { fg: theme.color.actionInk, bg: theme.color.action };
    case 'pending_upload':
      // Nothing has happened to it yet, so it wears the neutral.
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
        <View ref={listTarget} collapsable={false} style={{ gap: theme.space[3] }}>
          <Note text={tt('uploads.confirmBody')} />
          {episodes.isError ? (
            <>
              <Note text={tt(episodes.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} />
              <Button
                variant="secondary"
                label={tt('common.retry')}
                disabled={episodes.isFetching}
                onPress={() => void episodes.refetch()}
              />
            </>
          ) : null}
          {episodes.isPending || episodes.isFetching ? (
            <Body muted>{tt('common.loading')}</Body>
          ) : null}
        </View>
      }
      empty={
        episodes.isError || episodes.isPending ? null : (
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
            <Row label={tt('uploads.size')} value={episode.sizeBytes === null ? tt('uploads.sizeUnknown') : gb(episode.sizeBytes)} />
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
