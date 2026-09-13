import { useState } from 'react';
import { Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type EpisodeState } from '../api/types.ts';
import { uuid } from '../api/http.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import type { NativeTheme } from '@playerone/design/native';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Body, Button, Card, Choice, Hatch, ListScreen, Note, Row, Tag, Title, face } from '../ui.tsx';
import type { DeliveryRecord, DeliveryState, DeliveryStep } from '../upload/delivery.ts';
import { runDelivery } from '../upload/delivery.ts';
import {
  hashSession,
  nativeDeliveryStore,
  nativeTransport,
  pickSessionDirectory,
  type PickedSession,
} from '../upload/delivery-native.ts';
import type { MessageKey } from '../i18n.ts';

/**
 * APP-23/24: every episode and its state. APP-25: the upload starts from an
 * explicit, in-your-face confirmation and from nowhere else. There is no
 * "upload all", no auto-retry that starts a fresh upload, and no effect that
 * fires on network state. The collector decides what leaves their phone.
 *
 * APP-26 is the panel at the top: the collector points the system picker at a
 * recorded session directory, says which declared collection session it
 * belongs to (APP-16), and the phone hashes it, registers it and sends it. Then
 * it shows what the SERVER says about it. `uploaded` is never shown before the
 * server says `verified` — in fact this screen never says "uploaded" at all,
 * it prints the server's own state and the server's own reason.
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

/**
 * The delivery's own pill, off the same three-way palette as an episode's.
 *
 * `verified` and `ingesting` wear the ink of work in progress rather than a
 * verdict hue, because they are exactly that: the bytes are proven and nobody
 * has judged the recording yet. Only `ingested` is settled, and only `held` and
 * `failed` are refusals.
 */
const deliveryColors = (theme: NativeTheme, state: DeliveryState): { fg: string; bg: string } => {
  switch (state) {
    case 'ingested':
      return theme.color.verdict.pass;
    case 'held':
    case 'failed':
      return theme.color.verdict.reject;
    case 'registered':
      return { fg: theme.color.mutedForeground, bg: theme.color.muted };
    default:
      return { fg: theme.color.actionInk, bg: theme.color.action };
  }
};

const gb = (bytes: number): string => `${(bytes / 1024 ** 3).toFixed(1)} GB`;

/**
 * The server's reason, in the collector's language when this app has a sentence
 * for it and in the server's own words when it does not.
 *
 * The fallback is deliberate. `held_reason` and `failed_reason` are the
 * server's columns, and a reason a collector's footage was refused on is not
 * somewhere to print "an error occurred" because the catalogue was not updated.
 * Same argument as APP-27's reject reasons, which are PaXini's rows and are
 * shown verbatim.
 */
export const REASON_KEYS: Record<string, MessageKey> = {
  // What `collector_uploads.held_reason` and `failed_reason` can hold.
  checksum_mismatch: 'uploads.reasonChecksum',
  basename_collision: 'uploads.reasonCollision',
  // An operator ended a held delivery (0030). `held` is not terminal any more,
  // and the collector reads why it ended rather than watching it sit for ever.
  released_by_operator: 'uploads.reasonReleased',
  // The refusals this delivery path can raise, server-side and phone-side.
  upload_unknown_session: 'uploads.reasonUnknownSession',
  upload_foreign_session: 'uploads.reasonForeignSession',
  upload_already_complete: 'uploads.reasonAlreadyComplete',
  upload_checksum_mismatch: 'uploads.reasonChecksum',
  upload_basename_collision: 'uploads.reasonCollision',
  upload_payload_too_large: 'uploads.reasonTooLarge',
  upload_superseded: 'uploads.reasonSuperseded',
  session_basename_unrecognised: 'uploads.reasonBadName',
  upload_transport_failed: 'uploads.reasonTransport',
  upload_urls_expired: 'uploads.reasonExpired',
  upload_plan_mismatch: 'uploads.reasonPlanMismatch',
  upload_not_ready: 'uploads.reasonNotReady',
};

function reasonText(tt: (key: MessageKey) => string, reason: string): string {
  const key = REASON_KEYS[reason];
  return key === undefined ? reason : tt(key);
}

export function Uploads() {
  const api = useApi();
  const tt = useT();
  const theme = useTheme();
  const queryClient = useQueryClient();
  /** Whether the delivery panel is open. Closed until the collector taps. */
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<PickedSession | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Files hashed so far. The slow part, so it is the part that is reported. */
  const [hashed, setHashed] = useState<{ done: number; total: number } | null>(null);
  const [step, setStep] = useState<DeliveryStep | null>(null);
  const listTarget = useGuideTarget('uploads.list');

  const episodes = useQuery({ queryKey: ['episodes'], queryFn: () => api.episodes() });
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.sessions(), enabled: open });
  /**
   * The delivery this phone was interrupted in the middle of, if any.
   *
   * Read from the keystore, not from the server, because what it holds is the
   * half of the inventory the server has no use for: the `content://` URI of
   * every file, which is this phone's handle on its own storage and means
   * nothing anywhere else, and the client-generated upload id that makes a
   * resumed delivery the same delivery. The digests ARE on the server — the
   * registration declared them and `GET /api/me/uploads/:id` echoes them back —
   * so this record is not what protects them; it is what saves re-hashing a
   * session to rediscover which local file each one belongs to.
   */
  const held = useQuery({ queryKey: ['delivery', 'held'], queryFn: () => nativeDeliveryStore.get() });

  const pick = useMutation({
    mutationFn: () => pickSessionDirectory(),
    onSuccess: (session) => {
      setPicked(session);
      setStep(null);
      setHashed(null);
    },
  });

  const deliver = useMutation({
    /**
     * Hash, register, send, complete, and report what the server decided.
     *
     * One mutation for the whole thing, which is the app's existing pattern
     * for anything that changes state on the platform. It is `mutate`, called
     * from a button, never `useEffect` — the transfer must not start because a
     * screen mounted.
     */
    mutationFn: async (resuming: DeliveryRecord | null) => {
      const deps = { api, transport: nativeTransport, store: nativeDeliveryStore };
      if (resuming !== null) {
        return await runDelivery(deps, resuming, { resume: true, report: setStep });
      }
      if (picked === null || sessionId === null) throw new ApiError('upload_not_ready');
      const files = await hashSession(picked.files, (done, total) => setHashed({ done, total }));
      const record: DeliveryRecord = {
        // Client-generated and persisted before the first byte moves, so a
        // retry after a kill is the same delivery and not a second one.
        uploadId: uuid(),
        collectionSessionId: sessionId,
        sessionBasename: picked.sessionBasename,
        directoryUri: picked.directoryUri,
        files,
      };
      return await runDelivery(deps, record, { report: setStep });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['episodes'] });
      await queryClient.invalidateQueries({ queryKey: ['delivery', 'held'] });
    },
  });

  const outcome = deliver.data ?? null;
  const running = deliver.isPending;
  const resumable = held.data ?? null;

  return (
    <ListScreen
      title={tt('uploads.title')}
      data={episodes.data ?? []}
      keyOf={(episode) => episode.episodeId}
      header={
        <View ref={listTarget} collapsable={false} style={{ gap: theme.space[3] }}>
          <Note text={tt('uploads.confirmBody')} />
          <Card>
            <Title>{tt('uploads.deliverTitle')}</Title>
            <Body muted>{tt('uploads.deliverBody')}</Body>
            {!open ? (
              <Button label={tt('uploads.upload')} onPress={() => setOpen(true)} />
            ) : (
              <View style={{ gap: theme.space[3] }}>
                <Title>{tt('uploads.confirmTitle')}</Title>

                {/* A delivery that was interrupted. Resuming re-asks the server
                    what the cloud already holds and sends only the rest; it
                    never re-hashes and never registers a second delivery. */}
                {resumable !== null && picked === null ? (
                  <View style={{ gap: theme.space[2] }}>
                    <Row label={tt('uploads.session')} value={resumable.sessionBasename} />
                    <Button
                      label={tt('uploads.resume')}
                      disabled={running}
                      onPress={() => deliver.mutate(resumable)}
                    />
                  </View>
                ) : null}

                <Button
                  variant="secondary"
                  label={tt('uploads.pick')}
                  disabled={running || pick.isPending}
                  onPress={() => pick.mutate()}
                />
                {/* A folder that is not a session directory is refused by name,
                    not as "no folder was chosen" — the collector has to know
                    which of the two they are looking at. */}
                {pick.isError ? (
                  <Note
                    text={
                      pick.error instanceof ApiError
                        ? reasonText(tt, pick.error.code)
                        : tt('uploads.pickFailed')
                    }
                  />
                ) : null}

                {picked !== null ? (
                  <View style={{ gap: theme.space[2] }}>
                    <Row label={tt('uploads.directory')} value={picked.sessionBasename} />
                    <Row label={tt('uploads.files')} value={String(picked.files.length)} />
                    <Row
                      label={tt('uploads.size')}
                      value={gb(picked.files.reduce((sum, f) => sum + f.bytes, 0))}
                    />
                    {/* APP-16: the recording belongs to a session the collector
                        declared before they wore the camera. The app does not
                        guess which — a wrong attribution is a wrong payment. */}
                    <Body muted>{tt('uploads.chooseSession')}</Body>
                    {sessions.isError ? <Note text={tt('common.loadFailed')} /> : null}
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
                      {(sessions.data ?? []).map((session) => (
                        <Choice
                          key={session.id}
                          label={`${session.scenario} · ${session.createdAt.slice(0, 10)}`}
                          describedBy={tt('uploads.session')}
                          selected={sessionId === session.id}
                          disabled={running}
                          onPress={() => setSessionId(session.id)}
                        />
                      ))}
                    </View>
                    {(sessions.data ?? []).length === 0 && !sessions.isPending ? (
                      <Note text={tt('uploads.noSessions')} />
                    ) : null}
                  </View>
                ) : null}

                {hashed !== null ? (
                  <Body muted>{`${tt('uploads.hashing')} ${hashed.done}/${hashed.total}`}</Body>
                ) : null}
                {step !== null ? (
                  <Body muted>{`${tt('uploads.sending')} ${step.sentFiles}/${step.totalFiles}`}</Body>
                ) : null}

                {/* The server's verdict, and only ever the server's. */}
                {outcome !== null ? (
                  <View style={{ gap: theme.space[2] }}>
                    <Tag
                      label={tt(`delivery.${outcome.state}`)}
                      fg={deliveryColors(theme, outcome.state).fg}
                      bg={deliveryColors(theme, outcome.state).bg}
                    />
                    {outcome.heldReason !== null ? (
                      <Note text={reasonText(tt, outcome.heldReason)} />
                    ) : null}
                    {outcome.failedReason !== null ? (
                      <Note text={reasonText(tt, outcome.failedReason)} />
                    ) : null}
                  </View>
                ) : null}
                {deliver.isError ? (
                  <Note
                    text={
                      deliver.error instanceof ApiError
                        ? reasonText(tt, deliver.error.code)
                        : tt('common.actionFailed')
                    }
                  />
                ) : null}

                <Button
                  label={tt('uploads.start')}
                  disabled={running || picked === null || sessionId === null}
                  onPress={() => deliver.mutate(null)}
                />
                <Button
                  label={tt('common.cancel')}
                  variant="ghost"
                  disabled={running}
                  onPress={() => {
                    setOpen(false);
                    setPicked(null);
                    setSessionId(null);
                    setStep(null);
                    setHashed(null);
                    deliver.reset();
                  }}
                />
              </View>
            )}
          </Card>
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
          </Card>
        );
      }}
    />
  );
}
