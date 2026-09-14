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
import { Body, Button, Card, Choice, Note, Progress, Row, Tag, Title } from '../ui.tsx';
import {
  EmptyState,
  LimeTrack,
  LoadFailed,
  ScreenTitle,
  Skeleton,
  StaleStrip,
  WarmList,
  textStyle,
} from '../v2.tsx';
import type { DeliveryRecord, DeliveryState, DeliveryStep } from '@playerone/delivery';
import { runDelivery } from '@playerone/delivery';
import {
  hashSession,
  nativeDeliveryStore,
  nativeTransport,
  pickSessionDirectory,
  type PickedSession,
} from '../upload/delivery-native.ts';
import { shortId } from '../money.ts';
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
 *
 * ---------------------------------------------------------------------------
 * SPEC §13 restyles this screen and changes **nothing** about what it does.
 * This is the screen where a restyle is most likely to break something that
 * matters, so every state word, every refusal reason and every confirmation
 * step below is the one that was here before: `uploads.confirmTitle` /
 * `confirmBody` / `confirmCancel` stay a deliberate two-tap commitment, the
 * directory-picker flow is untouched, and all thirteen `uploads.reason*`
 * strings carry over verbatim.
 *
 * Two things did change, and both are §13's words:
 *
 * - **A passed episode says nothing about minutes or money here.** Effective
 *   minutes are the multiplicand of a payment and belong beside the amount
 *   they produced; §14 is the one screen that shows both together. Two places
 *   showing minutes is two places to disagree, and the one a collector quotes
 *   in a dispute must be the one with the money next to it.
 * - **The `uploading` pill is `discover.soft`, not lime.** The track beside it
 *   is already this screen's one lime moment, and §0.2 spends lime once.
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
       * outcome is recorded yet. The console reached the same place from the
       * other side — its risk band `review` and its `pending_zlp` attempt are
       * both `--warn-bg`/`--warn` — so an episode waiting on a reviewer and a
       * payment waiting on a gateway read alike, which is what they are. It is
       * not one of the three verdict hues and cannot be mistaken for one.
       */
      return { fg: theme.color.warn, bg: theme.color.warnBg };
    case 'uploading':
    case 'uploaded':
    case 'pending_upload':
      /*
       * The three machine states share one neutral, and `uploading` is
       * deliberately not louder than its siblings: §13 names `discover.soft`
       * for all three and bars lime here by name. Nothing has been judged yet,
       * so nothing wears a hue that means something about money. They are told
       * apart by their word and their glyph, which is §0.2's "never colour
       * alone" and is the half that survives colour blindness.
       */
      return { fg: theme.color.discover.ink, bg: theme.color.discover.soft };
  }
};

/**
 * The shape each state carries as well as its fill.
 *
 * `DESIGN.md`: "never colour alone — every verdict carries a shape too, because
 * red/green colour blindness is common and this axis decides whether somebody is
 * paid". §13 goes further and gives all six states a glyph, because three of
 * them now share one fill: an arrow for the bytes not yet moved and the bytes
 * moving, a light tick for arrived, an eye for a human holding it, a heavy tick
 * for passed and a cross for failed.
 */
const stateMarks: Record<EpisodeState, string> = {
  pending_upload: '↑',
  uploading: '⬆',
  uploaded: '✓',
  under_review: '◉',
  review_passed: '✔',
  review_failed: '✕',
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
      return { fg: theme.color.discover.muted, bg: theme.color.discover.soft };
    default:
      return { fg: theme.color.actionInk, bg: theme.color.action };
  }
};

/**
 * The delivery's own verdict marks, on the same argument as `stateMarks`.
 * `ingested` is the cloud copy proven and accepted; `held` and `failed` are
 * refusals. `registered`, `verified` and `ingesting` are work in progress and
 * carry no mark.
 */
const deliveryMarks: Partial<Record<DeliveryState, string>> = {
  ingested: '✓',
  held: '✕',
  failed: '✕',
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

  /**
   * SPEC §13 asks for a section list, one section per `CollectionSession`.
   * **It is not buildable against the API as it stands, so it is not faked.**
   * `GET /api/me/episodes` carries no collection session id — `api/http.ts`
   * sets `sessionId: ''` on every row and says why — so the only way to draw
   * those headings would be to guess which session an episode belongs to, and
   * a wrong attribution on an upload screen is a wrong attribution of work.
   * The rows are therefore one flat list in the server's own order. The
   * heading needs `collection_session_id` on that endpoint; nothing else here
   * changes when it arrives.
   */
  const micro = { ...textStyle(theme, 'micro'), color: theme.color.discover.muted };

  return (
    <WarmList
      data={episodes.data ?? []}
      keyOf={(episode) => episode.episodeId}
      refresh={{
        refreshing: episodes.isFetching && !episodes.isPending,
        onRefresh: () => void episodes.refetch(),
      }}
      header={
        <View ref={listTarget} collapsable={false} style={{ gap: theme.space[3] }}>
          <ScreenTitle>{tt('uploads.title')}</ScreenTitle>
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

                {/* The two slow phases, as the measured fractions they are.
                    Both counts come from the delivery's own callbacks; neither
                    is interpolated. */}
                {hashed !== null ? (
                  <Progress
                    label={tt('uploads.hashing')}
                    value={`${hashed.done}/${hashed.total}`}
                    fraction={hashed.total <= 0 ? 0 : hashed.done / hashed.total}
                  />
                ) : null}
                {step !== null ? (
                  <Progress
                    label={tt('uploads.sending')}
                    value={`${step.sentFiles}/${step.totalFiles}`}
                    fraction={step.totalFiles <= 0 ? 0 : step.sentFiles / step.totalFiles}
                  />
                ) : null}

                {/* The server's verdict, and only ever the server's. */}
                {outcome !== null ? (
                  <View style={{ gap: theme.space[2] }}>
                    <Tag
                      label={tt(`delivery.${outcome.state}`)}
                      fg={deliveryColors(theme, outcome.state).fg}
                      bg={deliveryColors(theme, outcome.state).bg}
                      mark={deliveryMarks[outcome.state]}
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
          {/* §17: a failed refresh keeps what is on screen; a failed load does
              not pretend there is anything to keep. */}
          {episodes.isError && episodes.data !== undefined ? (
            <StaleStrip text={tt('common.refreshFailed')} />
          ) : null}
          {episodes.isPending ? <Skeleton lines={4} /> : null}
        </View>
      }
      empty={
        episodes.isPending ? null : episodes.isError ? (
          <LoadFailed onRetry={() => void episodes.refetch()} />
        ) : (
          <EmptyState text={tt('uploads.empty')} />
        )
      }
      renderItem={(episode) => {
        const colors = stateColors(theme, episode.state);
        const uploading = episode.state === 'uploading';
        return (
          <View
            style={{
              backgroundColor: theme.color.discover.surface,
              borderRadius: theme.radius.lg,
              padding: theme.space[4],
              gap: theme.space[2],
            }}
          >
            {/* The episode's own name. SPEC §13's row tree does not list it,
                because the mock's rows sit under a session heading that carries
                the identity — and that heading is not buildable (see above). So
                the id stays: five anonymous rows is not a screen a collector can
                quote from in a dispute, and §14 names the same episode. */}
            <Text style={micro}>{shortId(episode.episodeId)}</Text>
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: theme.space[2],
              }}
            >
              <Tag
                label={tt(`state.${episode.state}`)}
                fg={colors.fg}
                bg={colors.bg}
                mark={stateMarks[episode.state]}
              />
              <Text style={{ ...textStyle(theme, 'caption'), color: theme.color.discover.muted }}>
                {episode.sizeBytes === null ? tt('uploads.sizeUnknown') : gb(episode.sizeBytes)}
              </Text>
            </View>

            {/* THE one lime moment on this screen: the episode actually
                transferring. The fill animates `transform: scaleX` on the
                native driver — never `width`, which would run on the JS thread
                and is the exact shape of the build the owner called laggy. */}
            {uploading && step !== null ? (
              <>
                <LimeTrack fraction={step.totalFiles <= 0 ? 0 : step.sentFiles / step.totalFiles} />
                <Text style={micro}>
                  {`${tt('uploads.sending')} · ${step.sentFiles}/${step.totalFiles}`}
                </Text>
              </>
            ) : null}

            {episode.state === 'under_review' ? (
              <Text style={micro}>{tt('uploads.waitingReviewer')}</Text>
            ) : null}

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
                    ...textStyle(theme, 'micro'),
                    color: theme.color.verdict.reject.fg,
                    fontWeight: theme.fontWeight.semibold,
                  }}
                >
                  {tt('uploads.reason')}
                </Text>
                <Text style={{ ...textStyle(theme, 'caption'), color: theme.color.discover.ink }}>
                  {episode.rejectReason}
                </Text>
              </View>
            ) : null}

            {/* The two-tap commitment, from the row that needs it. It opens the
                same panel and starts nothing on its own (APP-25). */}
            {episode.state === 'pending_upload' && !open ? (
              <Button
                label={tt('uploads.upload')}
                variant="secondary"
                onPress={() => setOpen(true)}
              />
            ) : null}
          </View>
        );
      }}
    />
  );
}
