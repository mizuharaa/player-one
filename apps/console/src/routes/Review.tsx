/**
 * The review lane: the screen where footage becomes money.
 *
 * The behaviour here is a faithful port of the server-rendered console's client
 * module, and the rules it enforces are the same rules, for the same reasons:
 *
 * **The client never sends a duration or an amount.** It sends marked spans and
 * a decision. The figure on screen is labelled an estimate because it is one —
 * the server computes money, rounds it in exactly one function, and the number
 * a collector is paid comes back from that. A client-side total that happened
 * to agree would be a second rounding site waiting to disagree.
 *
 * **A verdict is idempotent on a uuid this client generates.** The id is minted
 * when the episode is claimed, not when commit is pressed, so a double-tap and
 * a retry after a timeout both carry the same id and the unique index decides.
 * Through `settlements_review_key`, a second review row is a second payment.
 *
 * **The lease is held explicitly and released honestly.** A heartbeat every
 * 60s, a `sendBeacon` release on unload, and a 409 anywhere means somebody else
 * has this episode now — which is a state to explain, never an error to retry.
 *
 * The composition is the theatre: near-black around the video in both themes,
 * because `VQ-DARK` and `VQ-OVEREXPOSED` are reject reasons and bright chrome
 * bordering footage biases a call somebody is paid on. The rails carrying
 * metadata and controls stay on the light shell.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '../components/shell/AppShell.tsx';
import { Button, Key } from '../components/ui/button.tsx';
import { EmptyState, Field, FlagRow, Problem, Skeleton } from '../components/ui/primitives.tsx';
import { IconKeyboard, IconPartial, IconPass, IconReject, IconRefresh } from '../components/icons.tsx';
import { api, ApiError, type Claim, type ReasonCode, type Verdict } from '../lib/api.ts';
import { duration, money, signedPercent, signedSeconds } from '../lib/format.ts';
import { cn } from '../lib/cn.ts';

const RATES = [0.5, 0.75, 1, 1.5, 2, 3, 4] as const;
const HEARTBEAT_MS = 60_000;

interface Span {
  start: number;
  end: number | null;
}

export function ReviewScreen() {
  const { t, i18n } = useTranslation();
  const queryClient = useQueryClient();

  const [episode, setEpisode] = useState<Claim | null>(null);
  const [verdictId, setVerdictId] = useState<string>(() => crypto.randomUUID());
  const [spans, setSpans] = useState<Span[]>([]);
  const [decision, setDecision] = useState<Verdict | null>(null);
  const [reasons, setReasons] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [position, setPosition] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [partIndex, setPartIndex] = useState(0);
  const [lost, setLost] = useState<'lease' | 'media' | null>(null);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [claimedAt, setClaimedAt] = useState<number>(() => Date.now());

  const videoRef = useRef<HTMLVideoElement>(null);

  const reasonQuery = useQuery({
    queryKey: ['reasons'],
    queryFn: () => api.reasons(),
    staleTime: Infinity,
  });

  /** Reset everything that belongs to one episode. */
  const adopt = useCallback((claim: Claim | null) => {
    setEpisode(claim);
    setVerdictId(crypto.randomUUID());
    setSpans([]);
    setDecision(null);
    setReasons([]);
    setNote('');
    setPosition(0);
    setPartIndex(0);
    setPlaying(false);
    setLost(null);
    setClaimedAt(Date.now());
  }, []);

  const claim = useMutation({
    mutationFn: () => api.claimNext(),
    onSuccess: (next) => adopt(next),
  });

  /** Claim the first episode when the screen opens. */
  const claimMutate = claim.mutate;
  useEffect(() => {
    claimMutate();
  }, [claimMutate]);

  /* ---------------------------------------------------------------------
     The lease: a heartbeat while working, a beacon on the way out.
     ------------------------------------------------------------------ */

  const episodeId = episode?.episode_id ?? null;

  useEffect(() => {
    if (episodeId === null || lost !== null) return;
    const timer = setInterval(() => {
      api.heartbeat(episodeId).catch((err) => {
        if (err instanceof ApiError && err.isReassigned) setLost('lease');
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [episodeId, lost]);

  useEffect(() => {
    if (episodeId === null) return;
    const release = () => api.releaseOnUnload(episodeId);
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
    };
  }, [episodeId]);

  /* ---------------------------------------------------------------------
     Playback
     ------------------------------------------------------------------ */

  const parts = episode?.media.parts ?? [];
  const currentPart = parts[partIndex];

  const measured = episode ? Number.parseFloat(episode.measured_duration_seconds) : 0;

  useEffect(() => {
    const v = videoRef.current;
    if (v) v.playbackRate = rate;
  }, [rate, partIndex]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => setLost('media'));
    else v.pause();
  }, []);

  const nudge = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + seconds));
  }, []);

  const stepFrame = useCallback(
    (direction: number) => {
      const v = videoRef.current;
      if (!v) return;
      const fps = episode?.frame_rate ?? 30;
      v.pause();
      v.currentTime = Math.max(0, v.currentTime + direction / fps);
    },
    [episode?.frame_rate],
  );

  const changeRate = useCallback((direction: number) => {
    setRate((current) => {
      const index = RATES.findIndex((r) => Math.abs(r - current) < 0.01);
      const next = RATES[Math.min(RATES.length - 1, Math.max(0, (index < 0 ? 2 : index) + direction))];
      return next ?? current;
    });
  }, []);

  /* ---------------------------------------------------------------------
     Marking. Spans are what the client is allowed to send.
     ------------------------------------------------------------------ */

  const markIn = useCallback(() => {
    setSpans((current) => {
      /** An unclosed span already open: move its start rather than stacking. */
      const open = current.findIndex((s) => s.end === null);
      if (open >= 0) {
        const copy = [...current];
        copy[open] = { start: position, end: null };
        return copy;
      }
      return [...current, { start: position, end: null }];
    });
    setDecision('partial');
  }, [position]);

  const markOut = useCallback(() => {
    setSpans((current) => {
      const open = current.findIndex((s) => s.end === null);
      /** An out with no in is not an error the reviewer should have to undo. */
      if (open < 0) return current;
      const start = current[open]!.start;
      if (position <= start) return current;
      const copy = [...current];
      copy[open] = { start, end: position };
      return copy;
    });
  }, [position]);

  const clearAtPlayhead = useCallback(() => {
    setSpans((current) =>
      current.filter((s) => !(position >= s.start && position <= (s.end ?? Infinity))),
    );
  }, [position]);

  const closed = useMemo(() => spans.filter((s): s is { start: number; end: number } => s.end !== null), [spans]);
  const hasOpen = spans.some((s) => s.end === null);

  /**
   * The running figure, and the reason it is labelled an estimate.
   *
   * This sums the marked spans so a reviewer can see roughly what they are
   * about to award. It is not the payment: the server intersects, normalises,
   * converts exactly and rounds half away from zero in `quantise()`. Overlapping
   * marks in particular will total differently here and there — which is fine,
   * and is why the word "estimate" is on the screen and not in a comment.
   */
  const estimateSeconds = closed.reduce((total, s) => total + (s.end - s.start), 0);

  /* ---------------------------------------------------------------------
     The verdict
     ------------------------------------------------------------------ */

  const commit = useMutation({
    mutationFn: async () => {
      if (episode === null || decision === null) return null;
      return api.verdict({
        verdict_id: verdictId,
        episode_id: episode.episode_id,
        decision,
        spans: decision === 'partial' ? closed.map((s) => ({ start_seconds: s.start, end_seconds: s.end })) : [],
        reject_reasons: decision === 'bad' ? reasons : [],
        reviewer_note: note.trim() === '' ? null : note.trim(),
        time_to_verdict_seconds: (Date.now() - claimedAt) / 1000,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['shift'] });
      claim.mutate();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.isReassigned) setLost('lease');
    },
  });

  /**
   * Whether commit is allowed, mirroring the server's 422s.
   *
   * The server refuses a partial with no spans and a reject with no reasons,
   * and it is right to — but a reviewer should learn that from a disabled
   * button, not from a red box after they pressed it.
   */
  const canCommit =
    episode !== null &&
    decision !== null &&
    lost === null &&
    !commit.isPending &&
    (decision !== 'partial' || closed.length > 0) &&
    (decision !== 'bad' || reasons.length > 0);

  /* ---------------------------------------------------------------------
     Keyboard. The whole screen is reachable without a pointer, because at
     40,000 hours every second per episode multiplies by tens of thousands.
     ------------------------------------------------------------------ */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      /** Never steal a key from a text field. */
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case ' ':
          event.preventDefault();
          togglePlay();
          return;
        case 'ArrowLeft':
          event.preventDefault();
          if (event.shiftKey) stepFrame(-1);
          else nudge(-5);
          return;
        case 'ArrowRight':
          event.preventDefault();
          if (event.shiftKey) stepFrame(1);
          else nudge(5);
          return;
        case 'j':
        case 'J':
          changeRate(-1);
          return;
        case 'l':
        case 'L':
          changeRate(1);
          return;
        case 'i':
        case 'I':
          markIn();
          return;
        case 'o':
        case 'O':
          markOut();
          return;
        case 'x':
        case 'X':
          clearAtPlayhead();
          return;
        case '1':
          setDecision('good');
          return;
        case '2':
          setDecision('partial');
          return;
        case '3':
          setDecision('bad');
          return;
        case 'Enter':
          if (canCommit) commit.mutate();
          return;
        case '?':
          setShowShortcuts((s) => !s);
          return;
        case 'Escape':
          setShowShortcuts(false);
          return;
        default:
          return;
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [togglePlay, nudge, stepFrame, changeRate, markIn, markOut, clearAtPlayhead, canCommit, commit]);

  /* ------------------------------------------------------------------ */

  const shellProps = {
    queueDepth: episode?.queue_depth,
    averageSeconds: episode?.session_average_seconds,
  };

  /**
   * Playback is not authorised for this session, so there is no review to do.
   *
   * A whole screen rather than a banner over a live verdict panel: the server
   * refuses the claim as well as the footage, so nothing has been taken off the
   * queue and there is nothing here to decide. Offering the controls anyway
   * would invite a verdict on footage nobody watched, which is a payment.
   */
  if (claim.error instanceof ApiError && claim.error.isWithheld) {
    return (
      <AppShell {...shellProps}>
        <EmptyState
          title={t('state.playbackWithheld.title')}
          body={t('state.playbackWithheld.body')}
        />
      </AppShell>
    );
  }

  /** The queue is empty. A state, and the only one Cú is allowed on. */
  if (!claim.isPending && episode === null && !claim.isError) {
    return (
      <AppShell {...shellProps}>
        <EmptyState
          title={t('queue.empty.title')}
          body={t('queue.empty.body')}
          action={
            <Button variant="outline" onClick={() => claim.mutate()}>
              <IconRefresh size={17} />
              {t('queue.refresh')}
            </Button>
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell {...shellProps} bleed>
      <div className="grid min-h-[calc(100dvh-3.5rem)] lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------------- The theatre ---------------- */}
        <section className="on-stage flex min-w-0 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            {claim.isPending ? (
              <Skeleton className="aspect-video w-full max-w-[1100px] rounded-[var(--radius-lg)] bg-[var(--stage-panel)]" />
            ) : lost === 'media' ? (
              <div className="w-full max-w-[560px]">
                <Problem
                  onStage
                  title={t('state.mediaFailed.title')}
                  body={t('state.mediaFailed.body')}
                  action={
                    <Button variant="stage" onClick={() => claim.mutate()}>
                      {t('state.mediaFailed.action')}
                    </Button>
                  }
                />
              </div>
            ) : currentPart ? (
              <video
                ref={videoRef}
                key={currentPart.url}
                src={currentPart.url}
                className="max-h-full w-full max-w-[1100px] rounded-[var(--radius-base)] bg-black"
                preload="auto"
                onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() => setLost('media')}
                onEnded={() => {
                  if (partIndex < parts.length - 1) setPartIndex((i) => i + 1);
                }}
              />
            ) : null}
          </div>

          {/* Transport. Under the video, on the stage, never floating over it. */}
          <div className="border-t border-[var(--stage-line)] px-4 py-3">
            <Scrubber
              position={position}
              measured={measured}
              spans={spans}
              onSeek={(seconds) => {
                const v = videoRef.current;
                if (v) v.currentTime = seconds;
              }}
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="stage" size="sm" onClick={togglePlay}>
                {playing ? t('player.pause') : t('player.play')}
                <Key onStage>Space</Key>
              </Button>

              <span className="num text-[0.875rem] text-[var(--stage-fg)]">
                {duration(position)}{' '}
                <span className="text-[var(--stage-mid)]">/ {duration(measured)}</span>
              </span>

              <span className="num rounded-full border border-[var(--stage-line)] px-2 py-0.5 text-[0.75rem] text-[var(--stage-mid)]">
                {rate.toFixed(2)}×
              </span>

              {parts.length > 1 ? (
                <span className="text-[0.8125rem] text-[var(--stage-mid)]">
                  {t('player.part')} {partIndex + 1} {t('player.of')} {parts.length}
                </span>
              ) : null}

              <div className="ml-auto flex items-center gap-2">
                <Button variant="stage" size="sm" onClick={markIn}>
                  {t('mark.in')}
                  <Key onStage>I</Key>
                </Button>
                <Button variant="stage" size="sm" onClick={markOut} disabled={!hasOpen}>
                  {t('mark.out')}
                  <Key onStage>O</Key>
                </Button>
                <Button variant="stage" size="sm" onClick={clearAtPlayhead}>
                  {t('mark.clear')}
                  <Key onStage>X</Key>
                </Button>
                <Button
                  variant="stage"
                  size="icon"
                  onClick={() => setShowShortcuts((s) => !s)}
                  title={t('shortcuts.title')}
                >
                  <IconKeyboard size={17} />
                </Button>
              </div>
            </div>

            {/* The estimate, and the sentence that keeps it honest. */}
            <div className="mt-3 flex items-baseline gap-2">
              <span className="num text-[1.3125rem] font-bold text-[var(--sun-400)]">
                {duration(estimateSeconds)}
              </span>
              <span className="text-[0.8125rem] text-[var(--stage-mid)]">
                {t('mark.estimate')} · {t('mark.estimateHint')}
              </span>
            </div>
          </div>
        </section>

        {/* ---------------- The rail: what the machine knows, then the decision ---------------- */}
        <aside className="flex flex-col border-l border-[var(--border)] bg-[var(--background)]">
          {lost === 'lease' ? (
            <div className="p-4">
              <Problem
                title={t('state.leaseExpired.title')}
                body={t('state.leaseExpired.body')}
                action={
                  <Button variant="primary" onClick={() => claim.mutate()}>
                    {t('state.leaseExpired.action')}
                  </Button>
                }
              />
            </div>
          ) : null}

          <div className="flex-1 overflow-y-auto p-4">
            {claim.isPending || episode === null ? (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-28 w-full" />
              </div>
            ) : (
              <>
                <h1 className="num break-all text-[0.9375rem] font-bold leading-snug">
                  {episode.session_folder}
                </h1>

                <dl className="mt-4 divide-y divide-[var(--border)]">
                  <Field
                    label={t('meta.task')}
                    value={episode.task?.name ?? t('meta.unknown')}
                  />
                  <Field
                    label={t('meta.rate')}
                    value={
                      episode.task
                        ? `${money(episode.task.price_per_minute, episode.task.currency)} / min`
                        : t('meta.unknown')
                    }
                  />
                  <Field
                    label={t('meta.collector')}
                    value={episode.collector?.display_name ?? t('meta.unknown')}
                    tone="data"
                  />
                  <Field label={t('meta.measured')} value={duration(episode.measured_duration_seconds)} />
                  <Field
                    label={t('meta.claimed')}
                    value={duration(episode.claimed_duration_seconds)}
                  />
                  {episode.claimed_duration_seconds ? (
                    <Field
                      label={t('meta.discrepancy')}
                      tone="warn"
                      value={`${signedSeconds(episode.claimed_duration_seconds, episode.measured_duration_seconds)} · ${signedPercent(episode.claimed_duration_seconds, episode.measured_duration_seconds)}`}
                    />
                  ) : null}
                  <Field
                    label={t('meta.device')}
                    value={episode.device.serial ?? t('meta.unknown')}
                  />
                </dl>

                {/* The declaration a collector made before recording. APP-17b. */}
                {episode.declared ? (
                  <div className="mt-4 rounded-[var(--radius-base)] bg-[var(--muted)] px-3.5 py-3">
                    <p className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]">
                      {t('meta.declared')}
                    </p>
                    <dl className="mt-1">
                      <Field
                        label={t('meta.othersInFrame')}
                        value={episode.declared.others_in_frame ? t('meta.yes') : t('meta.no')}
                      />
                      <Field
                        label={t('meta.sensitive')}
                        value={episode.declared.sensitive_info_present ? t('meta.yes') : t('meta.no')}
                      />
                    </dl>
                  </div>
                ) : null}

                {episode.flags.length > 0 ? (
                  <div className="mt-4">
                    <p className="text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]">
                      {t('meta.flags')}
                    </p>
                    <div className="divide-y divide-[var(--border)]">
                      {episode.flags.map((f) => (
                        <FlagRow
                          key={f.code}
                          code={f.code}
                          detail={f.detail}
                          blocking={f.blocks_review}
                        />
                      ))}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* The decision. Pinned, because a verdict never requires scrolling. */}
          <div className="border-t border-[var(--border)] bg-[var(--card)] p-4">
            <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label={t('app.review')}>
              <VerdictChoice
                value="good"
                current={decision}
                onSelect={setDecision}
                label={t('verdict.good')}
                shortcut="1"
                Glyph={IconPass}
                fg="var(--pass)"
                bg="var(--pass-bg)"
              />
              <VerdictChoice
                value="partial"
                current={decision}
                onSelect={setDecision}
                label={t('verdict.partial')}
                shortcut="2"
                Glyph={IconPartial}
                fg="var(--partial)"
                bg="var(--partial-bg)"
              />
              <VerdictChoice
                value="bad"
                current={decision}
                onSelect={setDecision}
                label={t('verdict.bad')}
                shortcut="3"
                Glyph={IconReject}
                fg="var(--reject)"
                bg="var(--reject-bg)"
              />
            </div>

            {/* QR-04: a collector paid nothing has to be told why, in their language. */}
            {decision === 'bad' ? (
              <fieldset className="mt-3 max-h-40 overflow-y-auto rounded-[var(--radius-base)] border border-[var(--border)] p-2.5">
                <legend className="px-1 text-[0.75rem] font-semibold text-[var(--muted-foreground)]">
                  {t('verdict.reasons')}
                </legend>
                {(reasonQuery.data?.reasons ?? []).map((r: ReasonCode) => (
                  <label
                    key={r.code}
                    className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-[0.8125rem] hover:bg-[var(--muted)]"
                  >
                    <input
                      type="checkbox"
                      checked={reasons.includes(r.code)}
                      onChange={(e) =>
                        setReasons((current) =>
                          e.currentTarget.checked
                            ? [...current, r.code]
                            : current.filter((c) => c !== r.code),
                        )
                      }
                      className="mt-0.5 accent-[var(--sun-500)]"
                    />
                    <span>{i18n.language === 'zh' ? r.label_zh : r.label_en}</span>
                  </label>
                ))}
                {reasons.length === 0 ? (
                  <p className="px-1 pt-1 text-[0.75rem] text-[var(--reject)]">
                    {t('verdict.reasonsRequired')}
                  </p>
                ) : null}
              </fieldset>
            ) : null}

            {decision === 'partial' && closed.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-[var(--partial)]">{t('mark.needsSpan')}</p>
            ) : null}

            <textarea
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              placeholder={t('verdict.note')}
              rows={2}
              className="mt-3 w-full resize-none rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 text-[0.875rem] focus:border-[var(--sun-500)] focus:outline-none"
            />

            {commit.isError && !(commit.error instanceof ApiError && commit.error.isReassigned) ? (
              <p role="alert" className="mt-2 text-[0.8125rem] font-medium text-[var(--reject)]">
                {t('state.writeFailed.title')} — {(commit.error as Error).message}
              </p>
            ) : null}

            <Button
              variant="primary"
              size="lg"
              className="mt-3 w-full"
              disabled={!canCommit}
              onClick={() => commit.mutate()}
            >
              {commit.isPending ? t('verdict.committing') : t('verdict.commit')}
              <Key>↵</Key>
            </Button>
          </div>
        </aside>
      </div>

      {showShortcuts ? <Shortcuts onClose={() => setShowShortcuts(false)} /> : null}
    </AppShell>
  );
}

/**
 * The scrubber, with marked spans drawn into it.
 *
 * The spans are the point: a reviewer needs to see what they have already
 * awarded without reading a list. An open span (in, no out) is drawn hatched to
 * its current end so it is visibly unfinished rather than looking like a short
 * award.
 */
function Scrubber({
  position,
  measured,
  spans,
  onSeek,
}: {
  position: number;
  measured: number;
  spans: Span[];
  onSeek: (seconds: number) => void;
}) {
  const pct = (seconds: number) => (measured > 0 ? (seconds / measured) * 100 : 0);

  return (
    <div
      className="relative h-9 cursor-pointer select-none"
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        onSeek(((e.clientX - rect.left) / rect.width) * measured);
      }}
      role="slider"
      tabIndex={0}
      aria-label="Playhead"
      aria-valuemin={0}
      aria-valuemax={Math.round(measured)}
      aria-valuenow={Math.round(position)}
      aria-valuetext={duration(position)}
    >
      <div className="absolute inset-x-0 top-3.5 h-2 rounded-full bg-[var(--stage-line)]" />

      {spans.map((s, i) => (
        <div
          key={i}
          className={cn(
            'absolute top-3.5 h-2 rounded-full',
            s.end === null ? 'opacity-55' : '',
          )}
          style={{
            left: `${pct(s.start)}%`,
            width: `${Math.max(pct((s.end ?? position) - s.start), 0.4)}%`,
            background:
              s.end === null
                ? 'repeating-linear-gradient(90deg, var(--partial) 0 4px, transparent 4px 8px)'
                : 'var(--partial)',
          }}
        />
      ))}

      {/* Amber, because it has to stay visible over arbitrary footage. */}
      <div
        className="pointer-events-none absolute top-1.5 h-6 w-0.5 rounded-full bg-[var(--sun-400)]"
        style={{ left: `${pct(position)}%` }}
      />
    </div>
  );
}

function VerdictChoice({
  value,
  current,
  onSelect,
  label,
  shortcut,
  Glyph,
  fg,
  bg,
}: {
  value: Verdict;
  current: Verdict | null;
  onSelect: (v: Verdict) => void;
  label: string;
  shortcut: string;
  Glyph: typeof IconPass;
  fg: string;
  bg: string;
}) {
  const active = current === value;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={() => onSelect(value)}
      className={cn(
        'flex flex-col items-center gap-1 rounded-[var(--radius-base)] border-2 px-2 py-2.5',
        'text-[0.8125rem] font-bold transition-all duration-150 ease-[var(--ease)]',
        active ? '' : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--border-strong)]',
      )}
      style={active ? { borderColor: fg, backgroundColor: bg, color: fg } : undefined}
    >
      <Glyph size={19} />
      {label}
      <Key>{shortcut}</Key>
    </button>
  );
}

/**
 * The shortcut sheet.
 *
 * A `<dialog>` rather than a positioned div, so it escapes every `overflow`
 * ancestor, traps focus, and closes on Escape without any of that being
 * written here.
 */
function Shortcuts({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const rows: [string, string][] = [
    ['Space', t('shortcuts.playPause')],
    ['← →', t('shortcuts.seek')],
    ['⇧ ← →', t('shortcuts.frame')],
    ['J L', t('shortcuts.rate')],
    ['I', t('shortcuts.markIn')],
    ['O', t('shortcuts.markOut')],
    ['X', t('shortcuts.clear')],
    ['1 2 3', t('shortcuts.verdict')],
    ['↵', t('shortcuts.commit')],
    ['?', t('shortcuts.help')],
  ];

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(30rem,92vw)] rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--card)] p-0 text-[var(--foreground)] backdrop:bg-[var(--scrim)]"
    >
      <div className="p-5">
        <h2 className="text-[1.0625rem] font-bold">{t('shortcuts.title')}</h2>
        <dl className="mt-4 divide-y divide-[var(--border)]">
          {rows.map(([keys, description]) => (
            <div key={keys} className="flex items-center justify-between gap-4 py-2">
              <dt className="num text-[0.8125rem] font-semibold">{keys}</dt>
              <dd className="text-[0.8125rem] text-[var(--muted-foreground)]">{description}</dd>
            </div>
          ))}
        </dl>
        <Button variant="outline" className="mt-4 w-full" onClick={() => ref.current?.close()}>
          {t('shortcuts.show')}
        </Button>
      </div>
    </dialog>
  );
}
