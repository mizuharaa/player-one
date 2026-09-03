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
import {
  EmptyState,
  Field,
  FlagRow,
  Loading,
  Problem,
  Skeleton,
} from '../components/ui/primitives.tsx';
import { IconKeyboard, IconPartial, IconPass, IconReject, IconRefresh } from '../components/icons.tsx';
import {
  api,
  ApiError,
  holdLease,
  releaseHeld,
  type Claim,
  type ReasonCode,
  type Verdict,
} from '../lib/api.ts';
import { duration, durationShort, money, signedPercent, signedSeconds } from '../lib/format.ts';
import { focusKind, shortcutFires } from '../lib/shortcuts.ts';
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
  /**
   * How long the file that is playing runs for, as the element reports it.
   *
   * Only used to draw the transport. It is never sent, never totalled and never
   * compared with `measured_duration_seconds`: a container duration and a
   * payable span are two different numbers and the server owns the second one.
   */
  const [partSeconds, setPartSeconds] = useState(0);
  /** Set the moment the element has a duration and a first frame. */
  const [mediaReady, setMediaReady] = useState(false);
  const [lost, setLost] = useState<'lease' | 'media' | 'session' | null>(null);
  /** A skip that could not give the episode back. See `skipBroken`. */
  const [skipBlocked, setSkipBlocked] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [claimedAt, setClaimedAt] = useState<number>(() => Date.now());
  /** The lease clock: when the hold ends, and the tick that redraws it. */
  const [leaseUntil, setLeaseUntil] = useState<number | null>(null);
  const [clock, setClock] = useState<number>(() => Date.now());

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
    setPartSeconds(0);
    setMediaReady(false);
    setPlaying(false);
    setLost(null);
    setSkipBlocked(false);
    /** The copy the shell can reach, so sign-out can give this back. */
    holdLease(claim?.episode_id ?? null);
    setClaimedAt(Date.now());
    setClock(Date.now());
    setLeaseUntil(claim?.lease_expires_at ? Date.parse(claim.lease_expires_at) : null);
  }, []);

  /**
   * Whether this screen is still on the page.
   *
   * A claim is a write that takes a lease, and the response can arrive after
   * the reviewer has navigated away — at which point `episode` is nowhere, no
   * cleanup knows the id, and the server has just leased an episode to a screen
   * that no longer exists. It stays out of the queue for the full ten minutes.
   * So a claim that lands late is given straight back.
   *
   * Assigned in the effect body rather than initialised once, because React
   * `StrictMode` runs setup, cleanup and setup again on mount: a flag only ever
   * set false by the cleanup would be false for the whole session in
   * development.
   */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      /** A client-side navigation unmounts this screen without `pagehide`. */
      void releaseHeld();
    };
  }, []);

  const claim = useMutation({
    mutationFn: () => api.claimNext(),
    onSuccess: (next) => {
      if (!live.current) {
        if (next) void api.release(next.episode_id).catch(() => {});
        return;
      }
      adopt(next);
    },
  });

  /**
   * Claim the first episode when the screen opens. Once.
   *
   * `StrictMode` invokes an effect's setup, cleanup and setup again, and this
   * mutation is not cancellable — so in development the screen fired two
   * `POST /api/review/claim`s, and `claimNext` uses `SKIP LOCKED`, so the two
   * are answered with two *different* episodes. Only the response adopted last
   * is on screen and only that one is ever released; the other is leased to
   * nobody for ten minutes. Six seeded episodes and a few reloads is an empty
   * queue, which is also why the screenshot round kept photographing one.
   *
   * A ref rather than a cancellation: there is one first claim per mount and
   * this is the flag that says it has been made.
   */
  const startedFirstClaim = useRef(false);
  const claimMutate = claim.mutate;
  useEffect(() => {
    if (startedFirstClaim.current) return;
    startedFirstClaim.current = true;
    claimMutate();
  }, [claimMutate]);

  /**
   * Moving on from an episode whose media will not play.
   *
   * The lease is still held: nothing was decided, and simply claiming the next
   * one leaves this episode locked out of the queue for the rest of the lease
   * window — where the next reviewer to reach it finds nothing wrong except
   * that somebody else has it. So it goes back first.
   *
   * The release is awaited, and a failed one stops the move.
   *
   * It did not, and the arithmetic is why it now does: a reviewer meeting a run
   * of unplayable episodes on a network that is refusing releases skips through
   * all of them in seconds, and every one of those leases is held for ten
   * minutes with nobody watching it. That is the queue draining behind a screen
   * that looks like it is working. One reviewer waiting for the connection is
   * the cheaper of the two, and it is the honest one — the sentence beside the
   * button says which failure this is.
   *
   * The 409 is the exception: somebody else already holds the episode, so there
   * is nothing left to give back and claiming the next one is right.
   */
  const skipBroken = useCallback(async () => {
    const id = episode?.episode_id;
    if (id !== undefined) {
      try {
        await api.release(id);
        holdLease(null);
      } catch (err) {
        if (!(err instanceof ApiError && err.isReassigned)) {
          setSkipBlocked(true);
          return;
        }
      }
    }
    setSkipBlocked(false);
    claim.mutate();
  }, [episode?.episode_id, claim]);

  /* ---------------------------------------------------------------------
     The lease: a heartbeat while working, a beacon on the way out.
     ------------------------------------------------------------------ */

  const episodeId = episode?.episode_id ?? null;

  useEffect(() => {
    if (episodeId === null || lost !== null) return;
    const timer = setInterval(() => {
      api
        .heartbeat(episodeId)
        .then((extended) => {
          if (extended) setLeaseUntil(Date.parse(extended.lease_expires_at));
        })
        .catch((err) => {
          if (err instanceof ApiError && err.isReassigned) setLost('lease');
          /**
           * A 401 or a 403 is terminal and says so immediately.
           *
           * The session expired, or this operator is no longer allowed to
           * review. Neither recovers by waiting, and both used to present as a
           * ten-minute countdown that quietly stopped moving — so a reviewer
           * carried on marking spans against an episode they could no longer
           * commit, and learned that from the verdict failing.
           */
          else if (err instanceof ApiError && err.isUnauthenticated) setLost('session');
          /**
           * Every other failure is deliberately not classified here.
           *
           * A 500, a dropped LAN, a proxy that ate the request: the reviewer
           * does not need a taxonomy of those, they are all "try again and it
           * may work", and the countdown below says the only thing that matters
           * about them by not moving. A heartbeat that stops succeeding is
           * visible as the number it fails to extend.
           */
        });
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [episodeId, lost]);

  /**
   * How long this episode is held for, said out loud.
   *
   * The lease is ten minutes and the heartbeat renews it every sixty seconds,
   * so in the normal case this figure barely moves — which is the point. It
   * only falls when the renewal is failing, and the reviewer marking spans
   * against an episode that is about to be handed to somebody else is the one
   * who most needs to know before the 409 arrives and their marks are gone.
   *
   * A fifteen-second tick, not a per-second one: the number is read in minutes,
   * and a clock that re-renders the whole review surface once a second to move
   * a digit nobody is watching is a cost paid for nothing.
   */
  useEffect(() => {
    if (leaseUntil === null || lost !== null) return;
    const timer = setInterval(() => setClock(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, [leaseUntil, lost]);

  const leaseLeft = leaseUntil === null ? null : Math.max(0, (leaseUntil - clock) / 1000);
  /** Under two minutes is less than two heartbeats: the renewal is not working. */
  const leaseExpiring = leaseLeft !== null && leaseLeft < 120;

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

  /**
   * A mark on part two is not a time on the episode.
   *
   * `video.currentTime` is measured from the start of the file that is playing,
   * and a span is sent as an offset into the whole episode. On a single-part
   * episode those are the same number. On a multi-part one they are not, and
   * the difference is a payment: a span marked at 0:30 of part two is stored as
   * 0:30 of part one, and the server pays the intersection of the wrong window.
   *
   * The client cannot fix this on its own — `MediaPart` carries `index`, `url`,
   * `bytes` and `file`, and no offset — so it refuses to send a span it cannot
   * place. Good and reject still work; a partial does not.
   *
   * ponytail: this guard is retired by one field, and that field does not exist
   * yet. `EpisodeRecord.streams[].parts` is a `FileRef` — file, bytes, sha256 —
   * so the offset is not in the document `review.ts` reads
   * (`packages/contracts/src/episode.ts`, `Stream`). The engine measures it and
   * throws it away: `StreamTiming.partTimings[i].firstUs` in
   * `packages/ingest/src/timing.ts` minus `timing.usable_start_us` is exactly
   * the number. Persisting it is an additive record change plus a re-ingest,
   * which is an engine slice and not a console one — and until it lands, a
   * client that guessed the offset from the durations it can see would be a
   * second measurement of payable time, which is the one thing this client is
   * not allowed to be.
   */
  const markingBlocked = parts.length > 1;

  const measured = episode ? Number.parseFloat(episode.measured_duration_seconds) : 0;

  /**
   * What the transport is a transport *of*.
   *
   * On a single-part episode the file and the episode are the same thing, and
   * the scrubber spans the measured duration — which is the timeline a span is
   * sent in and the timeline the payment is computed over.
   *
   * On a multi-part one they are not the same thing, and the bar used to say
   * they were: `video.currentTime` is measured from the start of the file that
   * is playing, so entering part two reset the playhead to zero against a bar
   * still scaled to the whole episode, and clicking two thirds along seeked to
   * two thirds of the *episode* inside whichever file was loaded. A reviewer
   * navigating that skips footage without being told they skipped it.
   *
   * Rather than invent an episode timeline the client cannot place — see
   * `markingBlocked` — the bar becomes the part it is actually showing, and the
   * row beside it already says which part that is. Honest and small, in that
   * order.
   */
  const timelineSeconds = parts.length > 1 ? partSeconds : measured;

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
    if (markingBlocked) return;
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
  }, [position, markingBlocked]);

  const markOut = useCallback(() => {
    if (markingBlocked) return;
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
  }, [position, markingBlocked]);

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
    /** A claim in flight means the episode on screen may not be the one a
     *  verdict would land on. One authoritative episode at a time. */
    !claim.isPending &&
    /**
     * Nothing is judged that was never shown.
     *
     * An episode whose media list is empty renders a blank theatre, and every
     * other control still worked: a reviewer could pass it, and the pass is a
     * payment for footage nobody watched. `VQ-*` cannot be assessed against a
     * black rectangle.
     *
     * A non-empty list is not the same claim, which is why `mediaReady` is
     * here too: `preload="metadata"` and `onError` are both asynchronous, so
     * between the claim landing and the first frame decoding there is a window
     * — a second on a cold LAN — where the list is full, the theatre is black
     * and `1` then `Enter` pays for it. `loadedmetadata` is the element saying
     * it has a duration and a frame.
     *
     * Client-side, and therefore defence in depth rather than the control.
     * The authority is server-side and belongs to the media route: the lease
     * plus a first-open record per review and part, which is `media.ts` and
     * the reviewer-role slice that owns it, behind a default-off flag.
     */
     parts.length > 0 &&
     mediaReady &&
    /** ponytail: spans are refused on a multi-part episode — see `markingBlocked`. */
    (decision !== 'partial' || (closed.length > 0 && !markingBlocked)) &&
    (decision !== 'bad' || reasons.length > 0);

  /* ---------------------------------------------------------------------
     Keyboard. The whole screen is reachable without a pointer, because at
     40,000 hours every second per episode multiplies by tens of thousands.
     ------------------------------------------------------------------ */

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      /**
       * Never steal a key from something that is already listening — and steal
       * nothing from something that is not. The whole table, and why each half
       * of it exists, is in `lib/shortcuts.ts`.
       */
      if (!shortcutFires(focusKind(event.target as HTMLElement | null), event.key)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      /**
       * While the shortcut sheet is open, only the two keys that close it act.
       * Otherwise Space scrubs footage the reviewer cannot see behind a modal,
       * and 1/2/3 set a verdict they did not know they were setting.
       */
      if (showShortcuts && event.key !== '?' && event.key !== 'Escape') return;

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
  }, [
    togglePlay,
    nudge,
    stepFrame,
    changeRate,
    markIn,
    markOut,
    clearAtPlayhead,
    canCommit,
    commit,
    showShortcuts,
  ]);

  /* ------------------------------------------------------------------ */

  const shellProps = {
    queueDepth: episode?.queue_depth,
    averageSeconds: episode?.session_average_seconds,
  };

  /**
   * The claim itself failed.
   *
   * Without this the screen falls through to the theatre and renders three
   * skeletons that never resolve — a reviewer waiting on an episode that is
   * never coming, with a live verdict panel beside it. A failed read is a
   * state to explain and offer a retry for, and it is worth saying plainly
   * that nothing was claimed and nothing already committed is at risk.
   */
  if (claim.isError) {
    return (
      <AppShell {...shellProps}>
        <div className="mx-auto max-w-[46rem] py-16">
          <Problem
            title={t('state.loadFailed.title')}
            body={t('state.loadFailed.body')}
            action={
              <Button variant="primary" onClick={() => claim.mutate()}>
                <IconRefresh size={17} />
                {t('state.writeFailed.retry')}
              </Button>
            }
          />
        </div>
      </AppShell>
    );
  }

  /**
   * The queue is empty. A state, and the only one Cú is allowed on.
   *
   * `isIdle` is in the condition because the first claim is fired by an effect,
   * which runs after the first paint: for one frame the mutation had not
   * started, `episode` was null, and the screen said the queue was empty to a
   * reviewer whose episode was about to arrive.
   */
  if (!claim.isPending && !claim.isIdle && episode === null) {
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
      {/*
        `min-h` at every width, and a definite height from `lg` up.

        The rail's metadata column is `flex-1 overflow-y-auto`, which needs a
        parent whose height is decided by something other than its own content
        — without one the row simply grew, the column never scrolled, and the
        "pinned" decision panel was pinned to the bottom of a long page. On the
        desktop the grid is exactly the viewport and the rail scrolls inside
        itself. Below `lg` the two stack and the page scrolls, which is right on
        a phone; `sticky bottom-0` is what keeps the decision reachable there.
      */}
      <div className="grid min-h-[calc(100dvh-3.5rem)] lg:h-[calc(100dvh-3.5rem)] lg:min-h-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ---------------- The theatre ---------------- */}
        <section className="on-stage flex min-w-0 flex-col lg:min-h-0">
          <div className="flex min-h-0 flex-1 items-center justify-center p-4">
            {claim.isPending ? (
              <Loading label={t('player.loading')} className="w-full">
                <Skeleton className="aspect-video w-full max-w-[1100px] rounded-[var(--radius-lg)] bg-[var(--stage-panel)]" />
              </Loading>
            ) : lost === 'media' ? (
              <div className="w-full max-w-[560px]">
                <Problem
                  onStage
                  title={t('state.mediaFailed.title')}
                  body={
                    skipBlocked
                      ? t('state.mediaFailed.releaseFailed')
                      : t('state.mediaFailed.body')
                  }
                  action={
                    <Button variant="stage" onClick={() => void skipBroken()}>
                      {skipBlocked
                        ? t('state.writeFailed.retry')
                        : t('state.mediaFailed.action')}
                    </Button>
                  }
                />
              </div>
            ) : currentPart ? (
              <video
                ref={videoRef}
                key={currentPart.url}
                src={currentPart.url}
                aria-label={episode?.session_folder}
                className="max-h-full w-full max-w-[1100px] rounded-[var(--radius-base)] bg-[var(--stage-video)]"
                /*
                  `metadata`, not `auto`. An episode is a multi-gigabyte MP4 and
                  `auto` invites the browser to pull as much of it as it likes
                  the moment the element mounts — before the reviewer presses
                  Play, and on every episode auto-claimed and then skipped. The
                  link this travels is Shenzhen to an upload centre in Vietnam
                  and it has no measured budget. `metadata` gets the duration
                  and the first frame; pressing Play ranges in the rest.
                */
                preload="metadata"
                onLoadedMetadata={(e) => {
                  setMediaReady(true);
                  const d = e.currentTarget.duration;
                  setPartSeconds(Number.isFinite(d) ? d : 0);
                }}
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
              measured={timelineSeconds}
              spans={spans}
              onSeek={(seconds) => {
                const v = videoRef.current;
                if (v) v.currentTime = seconds;
              }}
            />

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="stage" size="sm" onClick={togglePlay}>
                {playing ? t('player.pause') : t('player.play')}
                <Key onStage>{t('shortcuts.spaceKey')}</Key>
              </Button>

              <span className="num text-[0.875rem] text-[var(--stage-fg)]">
                {duration(position)}{' '}
                <span className="text-[var(--stage-mid)]">/ {duration(timelineSeconds)}</span>
              </span>

              <span className="num rounded-full border border-[var(--stage-line)] px-2 py-0.5 text-[0.75rem] text-[var(--stage-mid)]">
                {rate.toFixed(2)}×
              </span>

              {parts.length > 1 ? (
                <span className="text-[0.8125rem] text-[var(--stage-mid)]">
                  {t('player.part')} {partIndex + 1} {t('player.of')} {parts.length}
                </span>
              ) : null}

              {/*
                `flex-wrap` and a conditional `ml-auto`: at 390px this group is
                wider than the viewport in English and 9px wider again in
                Chinese, and as one nowrap row inside a wrapping parent it
                pushed the whole document into a horizontal scroll.
              */}
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
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
                {/*
                  The shortcut that opens the shortcut sheet is printed on the
                  button, not kept inside the sheet it opens. A cheat sheet you
                  have to already know the key for teaches nobody.
                */}
                <Button
                  variant="stage"
                  size="sm"
                  onClick={() => setShowShortcuts((s) => !s)}
                  aria-label={t('shortcuts.title')}
                  aria-expanded={showShortcuts}
                >
                  <IconKeyboard size={17} />
                  <Key onStage>?</Key>
                </Button>
              </div>
            </div>

            {/* The estimate, and the sentence that keeps it honest. */}
            <div className="mt-3 flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="num text-[1.3125rem] font-bold text-[var(--sun-400)]">
                {duration(estimateSeconds)}
              </span>
              <span className="text-[0.8125rem] text-[var(--stage-mid)]">
                {t('mark.estimate')} · {t('mark.estimateHint')}
              </span>
            </div>

            {/*
              An open span is the one piece of state a reviewer can leave the
              screen in without noticing: the scrubber draws it hatched, but at
              a glance a hatched bar and a short award look alike.
            */}
            {hasOpen ? (
              <p className="mt-1.5 text-[0.8125rem] font-medium text-[var(--sun-400)]">
                {t('mark.pending')}
              </p>
            ) : null}

            {/* Said, not merely disabled: a control that does nothing teaches nothing. */}
            {markingBlocked ? (
              <p role="alert" className="mt-1.5 text-[0.8125rem] leading-snug text-[var(--stage-fg)]">
                {t('mark.multipart')}
              </p>
            ) : null}
          </div>
        </section>

        {/* ---------------- The rail: what the machine knows, then the decision ---------------- */}
        <aside className="flex flex-col border-l border-[var(--border)] bg-[var(--background)] lg:min-h-0">
          {lost === 'session' ? (
            /*
              A 401 or a 403 on the heartbeat. Terminal, and separated from the
              lease states because the answer is different: nothing on this
              screen will work again until somebody signs in, and claiming the
              next episode would fail the same way.
            */
            <div className="p-4">
              <Problem
                title={t('state.sessionEnded.title')}
                body={t('state.sessionEnded.body')}
                action={
                  <Button variant="primary" onClick={() => window.location.reload()}>
                    {t('state.sessionEnded.action')}
                  </Button>
                }
              />
            </div>
          ) : null}

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
              <Loading label={t('state.loading')} className="flex flex-col gap-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-28 w-full" />
              </Loading>
            ) : (
              <>
                <h1 className="num break-all text-[0.9375rem] font-bold leading-snug">
                  {episode.session_folder}
                </h1>

                {/*
                  The hold, and what is left of it.

                  `lease_expires_at` arrived on every claim and was rendered
                  nowhere, and `.lease-expiring` was an authored motion in the
                  design record with nothing wearing it. The consequence was a
                  reviewer marking spans against an episode that was quietly
                  being handed to somebody else — the first news of it a 409 on
                  commit, with the marks already gone.
                */}
                {leaseLeft !== null ? (
                  <p
                    className={cn(
                      'mt-1.5 text-[0.75rem]',
                      leaseExpiring
                        ? 'lease-expiring font-semibold text-[var(--reject-ink)]'
                        : 'text-[var(--faint-foreground)]',
                    )}
                  >
                    {t('lease.held')} <span className="num">{durationShort(leaseLeft)}</span>
                  </p>
                ) : null}
                {leaseExpiring ? (
                  <p
                    role="alert"
                    className="mt-1 text-[0.8125rem] leading-snug text-[var(--reject-ink)]"
                  >
                    {t('lease.ending')}
                  </p>
                ) : null}

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

          {/*
            The decision. Pinned, because a verdict never requires scrolling.

            On the desktop the rail is a column and this sits at its foot. Below
            `lg` the rail stacks under the theatre, and "pinned" was only true
            of the desktop: a phone showed a full viewport of video and metadata
            before the three buttons that end the episode. `sticky bottom-0`
            keeps them on screen at every width, which is the whole claim.
          */}
          <div className="sticky bottom-0 border-t border-[var(--border)] bg-[var(--card)] p-4 lg:static">
            {/*
              A group of toggle buttons rather than an ARIA radio group. A
              radiogroup owes a roving tabindex and arrow-key selection, and
              these are three real `<button>`s each carrying its own printed
              digit shortcut — the pattern they already behave as. Declaring
              `radiogroup` and then not implementing arrow keys is the worse of
              the two, because a screen-reader user is told to press an arrow
              that does nothing.
            */}
            <div className="grid grid-cols-3 gap-2" role="group" aria-label={t('app.review')}>
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

                {/*
                  Three states, and the failed one used to look like the empty
                  one: a box with nothing in it and a commit button that stays
                  disabled for a reason nobody is told. QR-04 cannot record a
                  rejection without this list, so its absence is worth a
                  sentence.
                */}
                {reasonQuery.isPending ? (
                  <Loading label={t('state.loading')} className="flex flex-col gap-1.5 px-1 py-1">
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-4 w-3/5" />
                    <Skeleton className="h-4 w-2/3" />
                  </Loading>
                ) : reasonQuery.isError ? (
                  <p role="alert" className="px-1 py-1 text-[0.8125rem] leading-snug text-[var(--reject-ink)]">
                    {t('verdict.reasonsFailed')}
                  </p>
                ) : (
                  <>
                    {(reasonQuery.data?.reasons ?? []).map((r: ReasonCode, index: number) => (
                      <label
                        key={r.code}
                        className="flex cursor-pointer items-start gap-2 rounded-[var(--radius-xs)] px-1 py-1 text-[0.8125rem] hover:bg-[var(--muted)]"
                      >
                        <input
                          type="checkbox"
                          /*
                            The reviewer pressed `3`; this list is what has to
                            happen next and the commit stays disabled until it
                            does. Without the focus move the only way in is Tab
                            from the top of the document — past the mark, the
                            logo, six nav pills and four bar controls — which is
                            the keyboard path silently ending at the reject
                            verdict. The list only mounts as a direct result of
                            that keystroke, so nothing is stolen.
                          */
                          autoFocus={index === 0}
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
                      <p className="px-1 pt-1 text-[0.75rem] text-[var(--reject-ink)]">
                        {t('verdict.reasonsRequired')}
                      </p>
                    ) : null}
                  </>
                )}
              </fieldset>
            ) : null}

            {decision === 'partial' && closed.length === 0 ? (
              /* A requirement sentence, so it wears `--reject-ink` and not the
                 partial hue: `--partial` is 3.81:1 on a light card and this is
                 13px text. See `packages/design/test/contrast.test.ts`. */
              <p className="mt-2 text-[0.8125rem] text-[var(--reject-ink)]">{t('mark.needsSpan')}</p>
            ) : null}

            {/*
              Nothing is judged before it has been shown. Said, because a
              commit button that is disabled for a reason nobody is told is the
              defect this screen keeps fixing.
            */}
            {decision !== null && parts.length > 0 && !mediaReady && lost === null ? (
              <p className="mt-2 text-[0.8125rem] text-[var(--muted-foreground)]">
                {t('player.notReady')}
              </p>
            ) : null}

            {/*
              A real label above the field, not only a placeholder.
              A placeholder is gone the moment there is any text in the box, so
              a reviewer who looked away mid-sentence came back to a paragraph
              with no name on it. `sr-only` was not an option either — the
              sighted reviewer is the one who loses it.
            */}
            <label
              htmlFor="verdict-note"
              className="mt-3 block text-[0.75rem] font-semibold uppercase tracking-[0.06em] text-[var(--faint-foreground)]"
            >
              {t('verdict.note')}
            </label>
            <textarea
              id="verdict-note"
              value={note}
              onChange={(e) => setNote(e.currentTarget.value)}
              placeholder={t('verdict.notePlaceholder')}
              rows={2}
              /*
                No `focus:outline-none` here: a complete review must be
                possible with no pointer at all, and a border colour change is
                not a focus indicator on a field whose border is already
                coloured. The sun ring in `globals.css` does this job.
              */
              className="mt-1 w-full resize-none rounded-[var(--radius-base)] border border-[var(--border-strong)] bg-[var(--card)] px-3 py-2 text-[0.875rem] focus:border-[var(--sun-500)]"
            />

            {commit.isError && !(commit.error instanceof ApiError && commit.error.isReassigned) ? (
              /*
                The server's own words are not printed. `Error.message` here is
                whatever Fastify produced — English, sometimes a stack-shaped
                string, never localised — and appending it put untranslated
                technical text into the middle of a Chinese screen at the one
                moment a reviewer needs to understand what happened. The detail
                still reaches the console for whoever is debugging.
              */
              <p role="alert" className="mt-2 text-[0.8125rem] font-medium text-[var(--reject-ink)]">
                {t('state.writeFailed.title')} — {t('state.writeFailed.body')}
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
  const { t } = useTranslation();
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
      aria-label={t('player.position')}
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
      aria-pressed={active}
      onClick={() => onSelect(value)}
      className={cn(
        'flex flex-col items-center gap-1 rounded-[var(--radius-base)] border-2 px-2 py-2.5',
        'text-[0.8125rem] font-bold transition-all duration-150 ease-[var(--ease)]',
        active
          ? 'text-[var(--foreground)]'
          : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--border-strong)]',
      )}
      /* Hue on the border and the glyph, ink on the word — see `VerdictPill`. */
      style={active ? { borderColor: fg, backgroundColor: bg } : undefined}
    >
      <Glyph size={19} style={active ? { color: fg } : undefined} />
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

  /**
   * `shortcuts.spaceKey` exists precisely for this row: arrows, digits and
   * letters are printed on the physical key in every locale, and "Space" is
   * the one legend that is a word. It was being rendered as an English
   * literal, which is the one place in this sheet a Chinese reviewer would
   * have found English.
   */
  const rows: [string, string][] = [
    [t('shortcuts.spaceKey'), t('shortcuts.playPause')],
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
            <div key={keys} className="flex items-start justify-between gap-4 py-2">
              <dt className="num shrink-0 text-[0.8125rem] font-semibold">{keys}</dt>
              <dd className="text-right text-[0.8125rem] text-[var(--muted-foreground)]">
                {description}
              </dd>
            </div>
          ))}
        </dl>
        {/* Labelled for what it does. It said "Shortcuts", which is the sheet. */}
        <Button variant="outline" className="mt-4 w-full" onClick={() => ref.current?.close()}>
          {t('shortcuts.close')}
        </Button>
      </div>
    </dialog>
  );
}
