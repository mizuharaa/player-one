import { Failure, StatePanel } from '../ui/StatePanel.tsx';
import { useToast } from '../ui/Toast.tsx';
import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, EPISODE_STATES, type EpisodeState } from '../api/types.ts';
import { uuid } from '../api/http.ts';
import { useApi } from '../api/context.tsx';
import { HEADSET_GUIDANCE } from '../headset-guidance.ts';
import { useLocale, useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import type { NativeTheme } from '@playerone/design/native';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Body, Button, face, Card, Chip, Choice, Field, Hatch, ListScreen, Loading, Note, Progress, Row, Screen, Tag, Title } from '../ui.tsx';
import { useNav } from '../nav.tsx';
import type { DeliveryRecord, DeliveryState, DeliveryStep } from '@playerone/delivery';
import { runPhoneDelivery } from '../upload/run-phone-delivery.ts';
import {
  hashSession,
  nativeDeliveryStore,
  nativeTransport,
  pickSessionDirectory,
  type PickedSession,
} from '../upload/delivery-native.ts';
import { dong, incomeStatus, isLivePaid, gb, shortId } from '../money.ts';
import type { MessageKey } from '../i18n.ts';
import { Icon, type IconName } from '../ui/Icon.tsx';
import { taskImage } from '../ui/taskImage.ts';


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

/** Text and SVG shapes distinguish pending work from a human verdict, without relying on colour. */
const stateMarks: Record<EpisodeState, IconName> = {
  pending_upload: 'upload',
  uploading: 'upload',
  uploaded: 'clock',
  under_review: 'clock',
  review_passed: 'circleCheck',
  review_failed: 'close',
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

/** Preserve useful precision for a photo or sidecar; GB alone rounds small uploads to zero. */
const bytesText = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : bytes < 1024 ** 3 ? `${(bytes / 1024 ** 2).toFixed(1)} MB` : gb(bytes);

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
  /**
   * The one refusal here that is not about this delivery: the platform's object
   * store did not answer, so no plan was signed and nothing was registered.
   * Answered 503 by the server, and read out of `constraint` like the rest.
   */
  storage_unavailable: 'uploads.reasonStorageDown',
  upload_cancelled: 'uploads.cancelled',
  upload_photos_denied: 'uploads.photosDenied',
  upload_camera_denied: 'uploads.cameraDenied',
  upload_media_unreadable: 'uploads.mediaUnreadable',
};

function reasonText(tt: (key: MessageKey) => string, reason: string): string {
  const key = REASON_KEYS[reason];
  return key === undefined ? reason : tt(key);
}

export function Uploads() {
  const api = useApi();
  const toast = useToast();
  const nav = useNav();
  const sending = useRef(false);
  const transfer = useRef<AbortController | null>(null);
  const activeRecord = useRef<DeliveryRecord | null>(null);
  const pickerRequest = useRef<AbortController | null>(null);
  useEffect(() => () => { transfer.current?.abort(); pickerRequest.current?.abort(); }, []);
  const [deliveryStage, setDeliveryStage] = useState(-1);
  const [deliveryMode, setDeliveryMode] = useState<'phone' | 'card' | null>(null);
  const { locale } = useLocale();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<EpisodeState | null>(null);
  const [selectedEpisode, setSelectedEpisode] = useState<string | null>(null);
  const tt = useT();
  // ponytail: foreground transfers keep this screen mounted; app-level ownership is needed for background transfers.
  useEffect(() => {
    nav.beforeLeave.current = () => {
      if (!sending.current) return true;
      toast(tt('uploads.keepOpen'), 'neutral');
      return false;
    };
    return () => { nav.beforeLeave.current = null; };
  }, [nav.beforeLeave, toast, tt]);
  const theme = useTheme();
  const queryClient = useQueryClient();
  /** Whether the delivery panel is open. Closed until the collector taps. */
  const [open, setOpen] = useState(nav.route.name === 'uploads' && nav.route.openDelivery === true);
  const [picked, setPicked] = useState<PickedSession | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  /** Files hashed so far. The slow part, so it is the part that is reported. */
  const [hashed, setHashed] = useState<{ done: number; total: number; file?: string; bytes?: number; totalBytes?: number } | null>(null);
  const [step, setStep] = useState<DeliveryStep | null>(null);
  const timing = useRef({ started: 0, progress: 0 });
  const [now, setNow] = useState(0);
  const reportStep = (next: DeliveryStep) => {
    timing.current.progress = Date.now();
    setStep(next);
  };
  const listTarget = useGuideTarget('uploads.list');

  const episodes = useQuery({ queryKey: ['episodes'], queryFn: () => api.episodes() });
  const income = useQuery({ queryKey: ['income'], queryFn: () => api.income() });
  const failed = [episodes, income].find(q => q.isError && q.data === undefined) ?? [episodes, income].find(q => q.isError);
  const sessions = useQuery({ queryKey: ['sessions'], queryFn: () => api.sessions(), enabled: open });
  useEffect(() => {
    // Only one explicit server session is unambiguous. Never guess among several.
    if (open && sessions.isSuccess && !sessions.isError && !sessionId && sessions.data.length === 1) setSessionId(sessions.data[0]!.id);
  }, [open, sessions.isSuccess, sessions.isError, sessions.data, sessionId]);
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
    mutationFn: async (source?: 'library' | 'camera') => {
      pickerRequest.current?.abort();
      const controller = new AbortController();
      pickerRequest.current = controller;
      try { return await pickSessionDirectory(source, controller.signal); }
      catch (error) { if (controller.signal.aborted) return null; throw error; }
    },
    onSuccess: (session) => {
      if (!session || pickerRequest.current?.signal.aborted) return;
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
      const signal = transfer.current!.signal;
      const deps = { api, store: nativeDeliveryStore, transport: {
        putFile: (uri: string, url: string, report?: (bytes: number) => void) => nativeTransport.putFile(uri, url, signal, report),
        putRange: (uri: string, url: string, start: number, end: number, report?: (bytes: number) => void) => nativeTransport.putRange(uri, url, start, end, signal, report),
      } };
      if (resuming !== null) {
        activeRecord.current = resuming;
        // A cancel can precede registration. Replaying the same ID also resumes registered uploads.
        return await runPhoneDelivery(deps, resuming, signal, { report: reportStep });
      }
      if (picked === null || sessionId === null) throw new ApiError('upload_not_ready');
      setHashed({ done: 0, total: picked.files.length });
      const files = await hashSession(picked.files, (done, total, progress) => {
        timing.current.progress = Date.now();
        setHashed({ done, total, ...progress });
      }, signal);
      if (signal.aborted) throw new ApiError('upload_cancelled');
      const record: DeliveryRecord = {
        // Client-generated and persisted before the first byte moves, so a
        // retry after a kill is the same delivery and not a second one.
        uploadId: uuid(),
        collectionSessionId: sessionId,
        sessionBasename: picked.sessionBasename,
        directoryUri: picked.directoryUri,
        files,
      };
      activeRecord.current = record;
      return await runPhoneDelivery(deps, record, signal, { report: reportStep });
    },
    onSuccess: outcome => { if (outcome.state === 'ingested') toast(tt('delivery.ingested')); },
    onSettled: () => {
      sending.current = false;
      void queryClient.invalidateQueries({ queryKey: ['episodes'] });
      void queryClient.invalidateQueries({ queryKey: ['delivery', 'held'] });
    },
  });

  const outcome = deliver.data ?? null;
  const running = deliver.isPending;
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [running]);
  const resumable = held.data ?? null;
  /**
   * How many bytes the picked session directory holds, which is what a
   * confirmed delivery is about to send.
   *
   * A byte count, not money: it is summed here, from the inventory the picker
   * already reported, and `money.ts` only formats it. Nothing about a payment
   * is derived from a size anywhere in this app.
   */
  const totalBytes = (picked?.files ?? []).reduce((sum, file) => sum + file.bytes, 0);

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
  const amounts = new Map((income.data ?? []).map(entry => [entry.episodeId, entry]));
  const needle = search.trim().toLocaleLowerCase(locale);
  const visible = (episodes.data ?? []).filter(episode => (filter === null || episode.state === filter) &&
    `${episode.episodeId} ${tt(`state.${episode.state}`)}`.toLocaleLowerCase(locale).includes(needle));
  const selected = episodes.data?.find(episode => episode.episodeId === selectedEpisode);
  const selectedSession = sessions.data?.find(session => session.id === sessionId);
  const sessionLabel = selectedSession ? `${tt(`scenario.${selectedSession.scenario}`)} · ${selectedSession.createdAt.slice(0, 10)}` : sessionId ?? '';
  const phase = step?.phase ?? (step ? 'sending' : 'hashing');
  const phaseLabel = tt(phase === 'hashing' ? 'uploads.hashing' : phase === 'registering' ? 'uploads.registering' : phase === 'verifying' ? 'uploads.verifying' : phase === 'ingesting' ? 'delivery.ingesting' : 'uploads.sending');
  const progressBytes = step ? step.sentBytes : hashed?.bytes;
  const progressTotal = step ? step.totalBytes : hashed?.totalBytes;
  const measurable = (phase === 'hashing' || phase === 'sending') && progressBytes !== undefined && !!progressTotal;
  const elapsed = Math.max(0, Math.floor((now - timing.current.started) / 1000));
  const start = (record: DeliveryRecord | null) => {
    if (sending.current) return;
    sending.current = true;
    activeRecord.current = record;
    setStep(null); setHashed(null);
    timing.current = { started: Date.now(), progress: Date.now() }; setNow(Date.now());
    transfer.current = new AbortController();
    deliver.mutate(record);
  };
  const close = () => {
    if (sending.current) { transfer.current?.abort(); return; }
    pickerRequest.current?.abort(); pick.reset();
    setOpen(false); setPicked(null); setSessionId(null); setStep(null); setHashed(null); setDeliveryStage(-1); setDeliveryMode(null); deliver.reset();
  };
  return <>
    <ListScreen title={tt('uploads.title')} data={visible} keyOf={episode => episode.episodeId}
      right={<Button label={tt('session.title')} variant="ghost" onPress={() => nav.push({ name: 'sessionReminder' })} />}
      refresh={{ refreshing: episodes.isFetching || income.isFetching, onRefresh: () => { void episodes.refetch(); void income.refetch(); } }}
      header={<View ref={listTarget} collapsable={false} style={{ gap: c.cardGap }}>
        {failed ? <Failure error={failed.error} text={tt(failed.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} onRetry={() => { void episodes.refetch(); void income.refetch(); }} busy={episodes.isFetching || income.isFetching} /> : null}
        <View style={{ borderRadius: c.radius.card, overflow: 'hidden', backgroundColor: c.paper }}>
          <Image source={taskImage({ scenario: 'home' })} accessible={false} style={{ width: '100%', height: 156 }} resizeMode="cover" />
          <View style={{ padding: c.cardPad, gap: theme.space[2] }}>
            <Text style={{ fontFamily: face(theme), ...c.type.caption, color: c.muted }}>{tt('landing.illustrativeScenes')}</Text>
            <Title>{tt('uploads.journeyTitle')}</Title>
            <Body muted>{tt('uploads.journeyBody')}</Body>
          </View>
        </View>
        <Button label={tt('uploads.deliverTitle')} onPress={() => setOpen(true)} />
        <Field label={tt('uploads.search')} value={search} onChangeText={setSearch} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: theme.space[2] }}>
          <Chip label={tt('uploads.all')} selected={filter === null} onPress={() => setFilter(null)} />
          {EPISODE_STATES.map(state => <Chip key={state} label={tt(`state.${state}`)} selected={filter === state} onPress={() => setFilter(state)} />)}
        </ScrollView>
        {income.isError && income.data === undefined ? <Body muted>{tt('income.title')} —</Body> : null}
        {episodes.isError && episodes.data === undefined ? <Body muted>{tt('uploads.title')} —</Body> : null}
        {episodes.isPending ? <Loading /> : null}
      </View>}
      empty={episodes.isPending || episodes.isError ? null : <Hatch action={tt('common.retry')} onPress={() => { setSearch(''); setFilter(null); void episodes.refetch(); }} text={tt(search.trim() || filter ? 'uploads.noMatches' : 'uploads.empty')} />}
      renderItem={episode => <Pressable accessibilityRole="button" accessibilityLabel={`${shortId(episode.episodeId)}. ${tt(`state.${episode.state}`)}. ${amounts.get(episode.episodeId)?.amountVnd == null ? '—' : dong(amounts.get(episode.episodeId)!.amountVnd!)}${amounts.has(episode.episodeId) ? `. ${tt(incomeStatus(amounts.get(episode.episodeId), episode.state === 'review_failed'))}` : ''}${amounts.get(episode.episodeId)?.simulation ? `. ${tt('payout.simulation')}` : ''}`}
        onPress={() => setSelectedEpisode(episode.episodeId)}
        style={({ pressed }) => ({ paddingVertical: c.cardPad, borderBottomWidth: 1, borderBottomColor: c.line,
          gap: c.cardGap, backgroundColor: c.surface, opacity: pressed ? .85 : 1 })}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: c.cardGap }}>
        <View style={{ width: 44, height: 44, borderRadius: c.radius.pill, borderWidth: 1, borderColor: c.line, backgroundColor: stateColors(theme, episode.state).bg, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={stateMarks[episode.state]} color={stateColors(theme, episode.state).fg} size={22} />
        </View>
        <View style={{ flex: 1, gap: theme.space[1] }}><Body>{shortId(episode.episodeId)}</Body><Body muted>{tt(`state.${episode.state}`)}</Body></View>
        <View style={{ flexShrink: 1, alignItems: 'flex-end' }}>
          <Text style={{ fontFamily: face(theme), ...c.type.body, color: isLivePaid(amounts.get(episode.episodeId), episode.state === 'review_failed') ? c.greenInk : c.muted }}>{amounts.get(episode.episodeId)?.amountVnd == null ? '—' : dong(amounts.get(episode.episodeId)!.amountVnd!)}</Text>
          {amounts.has(episode.episodeId) ? <Text style={{ fontFamily: face(theme), ...c.type.caption, color: c.muted }}>{tt(incomeStatus(amounts.get(episode.episodeId), episode.state === 'review_failed'))}</Text> : null}
        </View>
        </View>
        {amounts.get(episode.episodeId)?.simulation ? <Body muted>{tt('payout.simulation')}</Body> : null}
      </Pressable>} />
    <Modal visible={open} animationType="none" onRequestClose={close}>
      <Screen title={outcome ? tt(`delivery.${outcome.state}`) : deliver.isError ? tt('uploads.paused') : tt(!running && deliveryStage === 2 ? 'uploads.confirmTitle' : 'uploads.deliverTitle')}
        onBack={() => { if (!running) { pickerRequest.current?.abort(); pick.reset(); } if (!running && !outcome && !deliver.isError && deliveryStage > -1) { deliver.reset(); setDeliveryStage(deliveryStage - 1); } else close(); }}
        right={<Button label={tt('common.close')} variant="ghost" disabled={running} onPress={close} />}
        footer={running ? <Button label={tt('common.cancel')} variant="secondary" onPress={() => transfer.current?.abort()} /> : outcome ?
          <Button label={tt('common.done')} onPress={close} /> : deliver.isError ? null : deliveryStage === -1 ?
          <Button label={tt(deliveryMode === 'card' ? 'common.done' : 'common.next')} disabled={deliveryMode === null} onPress={() => deliveryMode === 'card' ? close() : setDeliveryStage(0)} /> : deliveryStage === 2 ?
          <Button label={tt('uploads.start')} disabled={!picked || !sessionId} onPress={() => start(null)} /> : deliveryStage === 1 ?
          <Button label={tt('common.next')} disabled={!sessionId || sessions.isError || sessions.isPending} onPress={() => setDeliveryStage(2)} /> :
          Platform.OS === 'ios' ? null : <Button label={tt('uploads.pick')} busy={pick.isPending} disabled={held.isPending || held.isError} onPress={() => pick.mutate()} />}>
          {!running && !outcome && !deliver.isError && (deliveryStage === 0 || deliveryStage === 1) && [held, sessions].some(q => q.isError) ? <Failure error={[held, sessions].find(q => q.isError)?.error} text={tt('common.loadFailed')} onRetry={() => { void held.refetch(); void sessions.refetch(); }} busy={held.isFetching || sessions.isFetching} /> : null}
        {Platform.OS === 'ios' && deliveryStage >= 0 ? <Note text={tt('uploads.libraryUnmeasured')} /> : null}
        {running || outcome || deliver.isError ? <>
          {running ? <Note text={tt('uploads.keepOpen')} /> : null}
          {!outcome ? <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3] }}>
              <Icon name={phase === 'sending' ? 'upload' : phase === 'hashing' ? 'file' : 'clock'} color={c.ink} size={28} />
              <View style={{ flex: 1 }}><Title>{phaseLabel}</Title></View>
            </View>
            {measurable ? <Progress label={step?.currentFile ?? hashed?.file ?? phaseLabel} value={`${Math.floor(Math.min(1, progressBytes / progressTotal) * 100)}%`} fraction={Math.min(1, progressBytes / progressTotal)} /> : null}
            {progressBytes !== undefined && progressTotal !== undefined ? <Body>{bytesText(progressBytes)} / {bytesText(progressTotal)}</Body> : null}
            {!measurable && (step?.currentFile || (!step && hashed?.file)) ? <Body>{step?.currentFile ?? hashed?.file}</Body> : null}
            {step || hashed ? <Body muted>{step ? `${step.sentFiles}/${step.totalFiles}` : `${hashed!.done}/${hashed!.total}`} {tt('uploads.files')}</Body> : null}
            {phase === 'verifying' || phase === 'ingesting' ? <Body muted>{tt('uploads.verifyingBody')}</Body> : null}
            {running ? <Body muted>{tt('uploads.elapsed')} {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')}</Body> : null}
          </Card> : null}
          {running && now - timing.current.progress >= 15_000 ? <Note tone="pending" text={tt('uploads.waitingProgress')} /> : null}
          {outcome ? <><View style={{ alignItems: 'center', paddingVertical: theme.space[5], gap: theme.space[3] }}>
            <Icon name={outcome.state === 'ingested' ? 'circleCheck' : outcome.state === 'held' || outcome.state === 'failed' ? 'close' : 'clock'} size={64} color={deliveryColors(theme, outcome.state).fg} />
            <Title>{tt(`delivery.${outcome.state}`)}</Title>
            {outcome.state !== 'ingested' && outcome.state !== 'held' && outcome.state !== 'failed' ? <Body muted>{tt('uploads.verifyingBody')}</Body> : null}
          </View>
            {outcome.heldReason ? <Note tone="pending" text={reasonText(tt, outcome.heldReason)} /> : null}
            {outcome.failedReason ? <Note tone="error" text={reasonText(tt, outcome.failedReason)} /> : null}</> : null}
          {deliver.isError ? <Failure error={deliver.error} text={deliver.error instanceof ApiError ? reasonText(tt, deliver.error.code) : tt('common.actionFailed')}
            onRetry={() => start(activeRecord.current)} busy={running} /> : null}
        </> : deliveryStage === -1 ? <>
          <Choice label={tt('uploads.byPhone')} selected={deliveryMode === 'phone'} onPress={() => setDeliveryMode('phone')} />
          <Choice label={tt('uploads.byCard')} selected={deliveryMode === 'card'} onPress={() => setDeliveryMode('card')} />
          {deliveryMode === 'card' ? <Note text={HEADSET_GUIDANCE.map(section => section.items).flat().find(item => item.id === 'handover')!.text[locale]} /> : null}
        </> : deliveryStage === 0 ? <>
          {Platform.OS === 'ios' ? <>
            <Button label={tt('uploads.takePhoto')} variant="secondary" disabled={pick.isPending || held.isPending || held.isError} onPress={() => pick.mutate('camera')} />
            <Button label={tt('uploads.chooseLibrary')} busy={pick.isPending} disabled={held.isPending || held.isError} onPress={() => pick.mutate('library')} />
          </> : <><Body>{tt('uploads.deliverBody')}</Body><Note text={tt('uploads.confirmBody')} /></>}
          {held.isError && held.data === undefined ? <Body muted>{tt('uploads.resume')} —</Body> : null}
          {resumable ? <Card><Row label={tt('uploads.session')} value={resumable.sessionBasename} /><Button label={tt('uploads.resume')} variant="secondary" onPress={() => start(resumable)} /></Card> : null}
          {pick.isError ? <Failure error={pick.error} text={pick.error instanceof ApiError ? reasonText(tt, pick.error.code) : tt('uploads.pickFailed')} onRetry={() => pick.mutate(pick.variables)} busy={pick.isPending} /> : null}
        </> : deliveryStage === 1 ? <>
          <Title>{tt('uploads.chooseSession')}</Title>
          <Body muted>{tt('uploads.sessionWhy')}</Body>
          {sessions.data?.length === 1 && sessionId ? <Note text={tt('uploads.sessionMatched')} /> : null}
          {sessions.isPending ? <Loading /> : null}
          {sessions.isError && sessions.data === undefined ? <Body muted>{tt('uploads.chooseSession')} —</Body> : null}
          {(sessions.data ?? []).map(session => <Choice key={session.id} label={`${tt(`scenario.${session.scenario}`)} · ${session.createdAt.slice(0, 10)}`}
            describedBy={tt('uploads.session')} selected={sessionId === session.id} onPress={() => setSessionId(session.id)} />)}
          {!sessions.isPending && !sessions.isError && sessions.data?.length === 0 ? <StatePanel title={tt('state.empty')} text={tt('uploads.noSessions')} action={tt('session.title')} onPress={() => { close(); nav.push({ name: 'sessionCreate' }); }} /> : null}
        </> : <>
          <Body>{tt('uploads.confirmBody')}</Body>
          {/*
            * What this delivery is about to send, before the collector confirms
            * it. The picker already reported every file's `bytes`, so the total
            * is a sum over the inventory this screen is holding — nothing is
            * asked of the server and nothing new is kept in the delivery state
            * machine, which still starts at `registered`.
            *
            * The connection line is static on purpose. React Native core has no
            * NetInfo, `expo-network` is not installed and adding a native module
            * means another APK rebuild for a sentence, so this app cannot tell
            * Wi-Fi from mobile data. Rather than guess, it names the size and
            * recommends Wi-Fi, and the collector — who knows what they are on —
            * decides. APP-28's real second confirmation needs the connection
            * type and is still not built.
            */}
          <Card><Row label={tt('uploads.directory')} value={picked?.sessionBasename ?? ''} />
            <Row label={tt('uploads.files')} value={String(picked?.files.length ?? 0)} />
            <Row label={tt('prechecks.totalSize')} value={gb(totalBytes)} />
            <Button label={tt('common.change')} variant="ghost" onPress={() => setDeliveryStage(0)} /></Card>
          <Card><Row label={tt('uploads.session')} value={sessionLabel} />
            <Button label={tt('common.change')} variant="ghost" onPress={() => setDeliveryStage(1)} /></Card>
          <Note text={tt('prechecks.connection').replace('{size}', gb(totalBytes))} />
        </>}
      </Screen>
    </Modal>
    <Modal visible={selected !== undefined} animationType="none" onRequestClose={() => setSelectedEpisode(null)}>
      {selected ? <Screen title={shortId(selected.episodeId)} onBack={() => setSelectedEpisode(null)}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}><Icon name={stateMarks[selected.state]} color={stateColors(theme, selected.state).fg} /><Tag label={tt(`state.${selected.state}`)} fg={stateColors(theme, selected.state).fg} bg={stateColors(theme, selected.state).bg} /></View>
        <Row label={tt('uploads.size')} value={selected.sizeBytes === null ? tt('uploads.sizeUnknown') : gb(selected.sizeBytes)} />
        {selected.rejectReason ? <Note tone="error" text={selected.rejectReason} /> : null}
        {selected.state === 'under_review' ? <Note tone="pending" text={tt('uploads.waitingReviewer')} /> : null}
        {selected.state === 'pending_upload' ? <Button label={tt('uploads.upload')} onPress={() => { setSelectedEpisode(null); setOpen(true); }} /> : null}
      </Screen> : null}
    </Modal>
  </>;
}
