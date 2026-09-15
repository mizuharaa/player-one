import { useRef, useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, type EpisodeState } from '../api/types.ts';
import { uuid } from '../api/http.ts';
import { useApi } from '../api/context.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import type { NativeTheme } from '@playerone/design/native';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Body, Button, face, Card, Choice, Hatch, ListScreen, Loading, Note, Progress, Row, Screen, Tag, Title } from '../ui.tsx';
import { useNav } from '../nav.tsx';
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
      return { fg: theme.collector.ink, bg: theme.collector.paper };
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
  const nav = useNav();
  const sending = useRef(false);
  const [deliveryStage, setDeliveryStage] = useState(0);
  const [selectedEpisode, setSelectedEpisode] = useState<string | null>(null);
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
      setDeliveryStage(1);
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
      sending.current = false;
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
  const c = theme.collector;
  const selected = episodes.data?.find(episode => episode.episodeId === selectedEpisode);
  const start = (record: DeliveryRecord | null) => {
    if (sending.current) return;
    sending.current = true;
    deliver.mutate(record);
  };
  const close = () => {
    if (running) return;
    setOpen(false); setPicked(null); setSessionId(null); setStep(null); setHashed(null); setDeliveryStage(0); deliver.reset();
  };
  return <>
    <ListScreen title={tt('uploads.title')} data={episodes.data ?? []} keyOf={episode => episode.episodeId}
      refresh={{ refreshing: episodes.isFetching, onRefresh: () => { void episodes.refetch(); } }}
      header={<View ref={listTarget} collapsable={false} style={{ gap: c.cardGap }}>
        <Button label={tt('uploads.deliverTitle')} onPress={() => setOpen(true)} />
        <Button label={tt('session.title')} variant="secondary" onPress={() => nav.push({ name: 'sessionReminder' })} />
        {episodes.isError ? <Note tone="error" text={tt(episodes.data ? 'common.refreshFailed' : 'common.loadFailed')} onRetry={() => void episodes.refetch()} busy={episodes.isFetching} /> : null}
        {episodes.isPending ? <Loading /> : null}
      </View>}
      empty={episodes.isPending || episodes.isError ? null : <Hatch text={tt('uploads.empty')} />}
      renderItem={episode => <Pressable accessibilityRole="button" accessibilityLabel={`${shortId(episode.episodeId)}. ${tt(`state.${episode.state}`)}`}
        onPress={() => setSelectedEpisode(episode.episodeId)}
        style={({ pressed }) => ({ paddingVertical: c.cardPad, borderBottomWidth: 1, borderBottomColor: c.line,
          flexDirection: 'row', alignItems: 'center', gap: c.cardGap, backgroundColor: pressed ? c.surface : undefined })}>
        <View style={{ width: 44, height: 44, borderRadius: c.radius.pill, borderWidth: 1, borderColor: c.line, alignItems: 'center', justifyContent: 'center' }}>
          <Text style={{ fontFamily: face(theme), ...c.type.h2, color: c.plum }}>{stateMarks[episode.state]}</Text>
        </View>
        <View style={{ flex: 1, gap: theme.space[1] }}><Body>{shortId(episode.episodeId)}</Body><Body muted>{tt(`state.${episode.state}`)}</Body></View>
        <Text style={{ fontFamily: face(theme), ...c.type.caption, color: c.muted, flexShrink: 1 }}>{episode.sizeBytes === null ? tt('uploads.sizeUnknown') : gb(episode.sizeBytes)}</Text>
      </Pressable>} />
    <Modal visible={open} animationType="none" onRequestClose={close}>
      <Screen title={outcome ? tt(`delivery.${outcome.state}`) : tt(running ? 'uploads.sending' : deliveryStage === 2 ? 'uploads.confirmTitle' : 'uploads.deliverTitle')}
        onBack={() => { if (!running && !outcome && deliveryStage > 0) { deliver.reset(); setDeliveryStage(deliveryStage - 1); } else close(); }}
        right={<Button label={tt('common.close')} variant="ghost" disabled={running} onPress={close} />}
        footer={running ? <Button label={tt('uploads.sending')} busy onPress={() => {}} /> : outcome ?
          <Button label={tt('common.done')} onPress={close} /> : deliver.isError ? null : deliveryStage === 2 ?
          <Button label={tt('uploads.start')} disabled={!picked || !sessionId} onPress={() => start(null)} /> : deliveryStage === 1 ?
          <Button label={tt('common.next')} disabled={!sessionId || sessions.isError || sessions.isPending} onPress={() => setDeliveryStage(2)} /> :
          <Button label={tt('uploads.pick')} busy={pick.isPending} disabled={held.isPending || held.isError} onPress={() => pick.mutate()} />}>
        {running || outcome || deliver.isError ? <>
          {hashed ? <Progress label={tt('uploads.hashing')} value={`${hashed.done}/${hashed.total}`} fraction={hashed.total ? hashed.done / hashed.total : 0} /> : null}
          {step ? <Progress label={tt('uploads.sending')} value={`${step.sentFiles}/${step.totalFiles}`} fraction={step.totalFiles ? step.sentFiles / step.totalFiles : 0} /> : null}
          {outcome ? <><Tag label={tt(`delivery.${outcome.state}`)} fg={deliveryColors(theme, outcome.state).fg} bg={deliveryColors(theme, outcome.state).bg} mark={deliveryMarks[outcome.state]} />
            {outcome.heldReason ? <Note tone="pending" text={reasonText(tt, outcome.heldReason)} /> : null}
            {outcome.failedReason ? <Note tone="error" text={reasonText(tt, outcome.failedReason)} /> : null}</> : null}
          {deliver.isError ? <Note tone="error" text={deliver.error instanceof ApiError ? reasonText(tt, deliver.error.code) : tt('common.actionFailed')}
            onRetry={() => start(resumable)} busy={running} /> : null}
        </> : deliveryStage === 0 ? <>
          <Body>{tt('uploads.deliverBody')}</Body><Note text={tt('uploads.confirmBody')} />
          {held.isError ? <Note tone="error" text={tt('common.loadFailed')} onRetry={() => void held.refetch()} busy={held.isFetching} /> : null}
          {resumable ? <Card><Row label={tt('uploads.session')} value={resumable.sessionBasename} /><Button label={tt('uploads.resume')} variant="secondary" onPress={() => start(resumable)} /></Card> : null}
          {pick.isError ? <Note tone="error" text={pick.error instanceof ApiError ? reasonText(tt, pick.error.code) : tt('uploads.pickFailed')} onRetry={() => pick.mutate()} busy={pick.isPending} /> : null}
        </> : deliveryStage === 1 ? <>
          <Title>{tt('uploads.chooseSession')}</Title>
          {sessions.isPending ? <Loading /> : null}
          {sessions.isError ? <Note tone="error" text={tt('common.loadFailed')} onRetry={() => void sessions.refetch()} busy={sessions.isFetching} /> : null}
          {(sessions.data ?? []).map(session => <Choice key={session.id} label={`${tt(`scenario.${session.scenario}`)} · ${session.createdAt.slice(0, 10)}`}
            describedBy={tt('uploads.session')} selected={sessionId === session.id} onPress={() => setSessionId(session.id)} />)}
          {!sessions.isPending && !sessions.isError && sessions.data?.length === 0 ? <Note text={tt('uploads.noSessions')} /> : null}
        </> : <>
          <Body>{tt('uploads.confirmBody')}</Body>
          <Card><Row label={tt('uploads.directory')} value={picked?.sessionBasename ?? ''} />
            <Row label={tt('uploads.session')} value={sessionId ?? ''} />
            <Row label={tt('uploads.files')} value={String(picked?.files.length ?? 0)} /></Card>
        </>}
      </Screen>
    </Modal>
    <Modal visible={selected !== undefined} animationType="none" onRequestClose={() => setSelectedEpisode(null)}>
      {selected ? <Screen title={shortId(selected.episodeId)} onBack={() => setSelectedEpisode(null)}>
        <Tag label={tt(`state.${selected.state}`)} fg={stateColors(theme, selected.state).fg} bg={stateColors(theme, selected.state).bg} mark={stateMarks[selected.state]} />
        <Row label={tt('uploads.size')} value={selected.sizeBytes === null ? tt('uploads.sizeUnknown') : gb(selected.sizeBytes)} />
        {selected.rejectReason ? <Note tone="error" text={selected.rejectReason} /> : null}
        {selected.state === 'under_review' ? <Note tone="pending" text={tt('uploads.waitingReviewer')} /> : null}
        {selected.state === 'pending_upload' ? <Button label={tt('uploads.upload')} onPress={() => { setSelectedEpisode(null); setOpen(true); }} /> : null}
      </Screen> : null}
    </Modal>
  </>;
}
