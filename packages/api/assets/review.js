// @ts-check
/**
 * The review screen.
 *
 * One ES module, no framework, no build step. It is loaded as written by the
 * browser, which means what is deployed is what is readable and an operator
 * with a text editor can see why the screen did something.
 *
 * Three things drive every decision in here.
 *
 * **The reviewer's hands never leave the keyboard.** Every action has a binding
 * and the mouse is optional throughout. Native video controls are not used
 * because they take keyboard focus and would swallow half the bindings.
 *
 * **An advance must be instant.** The next episode's payload is fetched and its
 * first video part is buffering in a second, hidden `<video>` element while the
 * current one is being watched. Committing swaps which element is visible. At
 * 40,000 hours a network stall per verdict is the programme's throughput
 * ceiling, and this is the one piece of the screen that removes it.
 *
 * **A lost verdict is a lost payment.** The client computes nothing that is
 * paid — it sends marked spans and the server decides what they are worth — and
 * a write that fails is a blocking, modal failure that puts the reviewer back
 * on the episode they were judging. Never a toast.
 */

const boot = JSON.parse(document.getElementById('bootstrap').textContent);
const M = boot.messages;
const t = (key) => M[key] ?? key;

const $ = (id) => document.getElementById(id);

/**
 * A v4 uuid, without needing a secure context.
 *
 * `crypto.randomUUID` exists only on HTTPS and on localhost. Pilot upload
 * centres are a LAN over plain HTTP, where it is simply absent — and the one
 * place this is used is the verdict's idempotency key, so the failure would be
 * a `TypeError` at the moment a reviewer commits, on exactly the machines the
 * pilot runs on and on none of the machines it was developed on.
 * `crypto.getRandomValues` has no such restriction.
 */
function uuid() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const el = {
  app: $('app'),
  videoA: $('video-a'),
  videoB: $('video-b'),
  videoEmpty: $('video-empty'),
  play: $('play'),
  time: $('time'),
  rate: $('rate'),
  partIndicator: $('part-indicator'),
  scrub: $('scrub'),
  scrubBuffered: $('scrub-buffered'),
  scrubSpans: $('scrub-spans'),
  scrubParts: $('scrub-parts'),
  scrubPending: $('scrub-pending'),
  scrubHead: $('scrub-head'),
  markIn: $('mark-in'),
  markOut: $('mark-out'),
  markClear: $('mark-clear'),
  markingHint: $('marking-hint'),
  estimateDuration: $('estimate-duration'),
  estimateAmount: $('estimate-amount'),
  spans: $('spans'),
  meta: $('meta'),
  flags: $('flags'),
  recent: $('recent'),
  queueDepth: $('queue-depth'),
  queueAverage: $('queue-average'),
  reasonsWrap: $('reasons-wrap'),
  reasons: $('reasons'),
  note: $('note'),
  verdictError: $('verdict-error'),
  commit: $('commit'),
  shortcuts: $('shortcuts'),
  shortcutsToggle: $('shortcuts-toggle'),
  screenEmpty: $('screen-empty'),
  screenMedia: $('screen-media'),
  screenLoad: $('screen-load'),
  screenLoadDetail: $('screen-load-detail'),
  blocker: $('blocker'),
  blockerTitle: $('blocker-title'),
  blockerBody: $('blocker-body'),
  blockerPrimary: $('blocker-primary'),
  blockerSecondary: $('blocker-secondary'),
};

// ---------------------------------------------------------------------------
// Formatting. Display only — nothing below decides money.

const pad = (n, width = 2) => String(Math.floor(n)).padStart(width, '0');

/** `m:ss.cc`. Centiseconds because a frame at 30 fps is 3 of them. */
function fmtTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds);
  const cs = Math.floor((seconds - whole) * 100);
  return `${Math.floor(whole / 60)}:${pad(whole % 60)}.${pad(cs)}`;
}

const fmtSeconds = (text) => (text === null || text === undefined ? '—' : fmtTime(Number(text)));

// ---------------------------------------------------------------------------
// Timeline
//
// An episode's footage is one or more `_partNNNN.mp4` files written by the
// device. To the reviewer it is a single recording and a span is marked against
// a single timeline, so the part boundaries have to be invisible in the
// numbers — a span from 0:58 to 1:12 that crosses a file boundary is still one
// span from 58 to 72 seconds.
//
// Part durations are not in the store: the engine records stream spans and
// payable windows, not per-file container lengths. So the client measures them,
// with a detached element per part reading metadata only. That is one small
// range request per part when the moov atom is at the front of the file, and
// the whole reason the moov's position matters to this screen.

class Timeline {
  /** @param {{index:number,url:string}[]} parts */
  constructor(parts) {
    this.parts = parts;
    /** @type {number[]} cumulative start of each part, in episode seconds */
    this.offsets = parts.map(() => 0);
    this.durations = parts.map(() => 0);
    this.total = 0;
    this.ready = false;
  }

  /**
   * Reads each part's duration. Single-part episodes — which is most of them —
   * take the live element's own metadata rather than a second request for a
   * file the browser is already loading.
   *
   * @param {HTMLVideoElement} live the element already loading part 0
   */
  async measure(live) {
    if (this.parts.length === 0) {
      this.ready = true;
      return;
    }
    const durations = await Promise.all(
      this.parts.map((part, index) =>
        index === 0 ? durationOf(live, part.url) : probeDuration(part.url),
      ),
    );
    let running = 0;
    for (const [index, duration] of durations.entries()) {
      this.offsets[index] = running;
      this.durations[index] = duration;
      running += duration;
    }
    this.total = running;
    this.ready = true;
  }

  /** Episode seconds to a part and an offset inside it. */
  locate(episodeSeconds) {
    const clamped = Math.max(0, Math.min(episodeSeconds, Math.max(0, this.total - 0.001)));
    for (let i = this.parts.length - 1; i >= 0; i -= 1) {
      if (clamped >= this.offsets[i]) return { index: i, offset: clamped - this.offsets[i] };
    }
    return { index: 0, offset: 0 };
  }

  /** A part and an offset inside it back to episode seconds. */
  toEpisode(index, offset) {
    return (this.offsets[index] ?? 0) + offset;
  }
}

/** Waits for metadata on an element that is already loading `url`. */
function durationOf(video, url) {
  return new Promise((resolve) => {
    if (video.readyState >= 1 && Number.isFinite(video.duration)) return resolve(video.duration);
    const done = () => {
      video.removeEventListener('loadedmetadata', done);
      video.removeEventListener('error', fail);
      resolve(Number.isFinite(video.duration) ? video.duration : 0);
    };
    const fail = () => {
      video.removeEventListener('loadedmetadata', done);
      video.removeEventListener('error', fail);
      resolve(0);
    };
    video.addEventListener('loadedmetadata', done);
    video.addEventListener('error', fail);
    void url;
  });
}

/** Metadata only, on a detached element that is discarded straight after. */
function probeDuration(url) {
  return new Promise((resolve) => {
    const probe = document.createElement('video');
    probe.preload = 'metadata';
    probe.muted = true;
    const finish = (value) => {
      probe.removeAttribute('src');
      probe.load();
      resolve(value);
    };
    probe.addEventListener('loadedmetadata', () =>
      finish(Number.isFinite(probe.duration) ? probe.duration : 0),
    );
    probe.addEventListener('error', () => finish(0));
    probe.src = url;
  });
}

// ---------------------------------------------------------------------------
// Marking

/**
 * Merges what the reviewer marked, the same way the server will.
 *
 * Kept deliberately close to `normaliseSpans` in `money.ts` so the running
 * estimate does not disagree with the figure that lands in the bill — but this
 * is the estimate and that is the payment, and the label on screen says so. If
 * the two ever diverge the server is right by definition.
 */
function mergeSpans(spans, limit) {
  const clean = spans
    .map((s) => ({ start: Math.max(0, Math.min(s.start, limit)), end: Math.max(0, Math.min(s.end, limit)) }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const span of clean) {
    const last = merged[merged.length - 1];
    if (last && span.start <= last.end) last.end = Math.max(last.end, span.end);
    else merged.push({ ...span });
  }
  return merged;
}

const totalOf = (spans) => spans.reduce((sum, s) => sum + (s.end - s.start), 0);

// ---------------------------------------------------------------------------
// State

const state = {
  /** The episode being judged, as the server described it. */
  episode: null,
  reviewId: null,
  /** Resolves once the claim for the current episode has come back. */
  claiming: null,
  timeline: new Timeline([]),
  /** Which element is on screen. The other is buffering the next episode. */
  live: el.videoA,
  spare: el.videoB,
  partIndex: 0,
  spans: [],
  pendingIn: null,
  decision: null,
  reasons: new Set(),
  /** What `/api/review/next` last returned, and which element holds its bytes. */
  prefetched: null,
  loadedAt: 0,
  reasonCatalogue: [],
  heartbeat: null,
  committing: false,
  blocked: false,
};

// ---------------------------------------------------------------------------
// Networking

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
    ...options,
  });
  if (response.status === 204) return { status: 204, body: null };
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { status: response.status, body };
}

const post = (path, payload) =>
  api(path, { method: 'POST', body: payload === undefined ? undefined : JSON.stringify(payload) });

// ---------------------------------------------------------------------------
// Named states
//
// Each of these is a real, mutually exclusive screen rather than a branch that
// hides one element. A reviewer should never be looking at half of one state
// and half of another and have to work out which is current.

const SCREENS = { empty: el.screenEmpty, media: el.screenMedia, load: el.screenLoad };

function showScreen(name, detail) {
  for (const [key, node] of Object.entries(SCREENS)) node.hidden = key !== name;
  el.app.dataset.screen = name ?? '';
  if (name === 'load' && detail) el.screenLoadDetail.textContent = detail;
  if (name !== null) {
    state.live.pause();
    stopHeartbeat();
  }
}

const clearScreen = () => showScreen(null);

/**
 * The modal failure. Used for exactly two things: a verdict that did not reach
 * the server, and a lease that expired underneath the reviewer. Both mean work
 * has been lost or is about to be, and both have to be acknowledged.
 */
function block({ title, body, primary, onPrimary, secondary, onSecondary }) {
  state.blocked = true;
  el.blockerTitle.textContent = title;
  el.blockerBody.textContent = body;
  el.blockerPrimary.textContent = primary;
  el.blockerPrimary.onclick = onPrimary;
  el.blockerSecondary.hidden = secondary === undefined;
  if (secondary !== undefined) {
    el.blockerSecondary.textContent = secondary;
    el.blockerSecondary.onclick = onSecondary;
  }
  el.blocker.hidden = false;
  el.blockerPrimary.focus();
}

function unblock() {
  state.blocked = false;
  el.blocker.hidden = true;
}

// ---------------------------------------------------------------------------
// Rendering

function renderMeta(episode) {
  const rows = [];
  const row = (label, value, options = {}) =>
    rows.push(
      `<div class="meta-row${options.strong ? ' row-strong' : ''}" style="display:contents">` +
        `<dt>${escape(label)}</dt><dd${options.class ? ` class="${options.class}"` : ''}>${
          options.html ?? escape(value)
        }${options.hint ? `<span class="hint">${escape(options.hint)}</span>` : ''}</dd></div>`,
    );

  row(t('meta.folder'), episode.session_folder);
  if (episode.task) {
    row(t('meta.task'), episode.task.name);
    row(
      t('meta.rate'),
      `${episode.task.price_per_minute} ${episode.task.currency}`,
    );
  }
  if (episode.collector) row(t('meta.collector'), episode.collector.display_name);
  if (episode.scenario) {
    row(t('meta.scenario'), `${episode.scenario.code} · ${episode.scenario.privacy_risk_level}`);
  }
  row(t('meta.device'), `${episode.device.serial} · ${episode.device.firmware ?? t('meta.unknown')}`);

  /**
   * The two durations, side by side, with the gap between them spelled out.
   *
   * UPL-08 makes the device manifest advisory and its `duration_sec` is wall
   * clock, which overstates the media by about a third. A reviewer who can see
   * that gap can tell a device with a clock problem from a collector with a
   * short recording; one who cannot see it will read the smaller number as a
   * loss and start arguing about the wrong thing.
   */
  row(t('meta.measured'), fmtSeconds(episode.measured_duration_seconds), {
    strong: true,
    hint: t('meta.measuredHint'),
  });
  if (episode.claimed_duration_seconds !== null && episode.claimed_duration_seconds !== undefined) {
    const measured = Number(episode.measured_duration_seconds);
    const claimed = Number(episode.claimed_duration_seconds);
    const delta = claimed - measured;
    const pct = measured > 0 ? (delta / measured) * 100 : 0;
    row(t('meta.claimed'), fmtSeconds(episode.claimed_duration_seconds), {
      hint: t('meta.claimHint'),
    });
    row(t('meta.discrepancy'), '', {
      html:
        `<span class="delta${Math.abs(pct) >= 10 ? ' is-wide' : ''}">` +
        `${delta >= 0 ? '+' : '−'}${fmtTime(Math.abs(delta))} (${delta >= 0 ? '+' : '−'}${Math.abs(pct).toFixed(1)}%)</span>`,
    });
  }

  row(
    t('meta.recorded'),
    episode.recorded_at ? new Date(episode.recorded_at).toLocaleString(boot.lang) : t('meta.unknown'),
  );
  row(t('meta.timing'), `${episode.timing.source} · ${episode.timing.confidence}`);
  row(
    t('meta.attribution'),
    [episode.resolver_note.method ?? '—', episode.resolver_note.start_source ?? null]
      .filter(Boolean)
      .join(' · '),
  );
  if (episode.declared) {
    row(
      t('meta.declared'),
      '',
      {
        html:
          `${escape(t('meta.othersInFrame'))}: ${escape(
            episode.declared.others_in_frame ? t('meta.yes') : t('meta.no'),
          )}<br>${escape(t('meta.sensitive'))}: ${escape(
            episode.declared.sensitive_info_present ? t('meta.yes') : t('meta.no'),
          )}`,
      },
    );
  }
  row(t('meta.episode'), episode.episode_id, { class: 'mono' });

  el.meta.innerHTML = rows.join('');

  el.flags.innerHTML =
    episode.flags.length === 0
      ? `<p class="spans-empty" style="border:0;padding:0">${escape(t('meta.flags'))}: ${escape(
          t('meta.none'),
        )}</p>`
      : episode.flags
          .map(
            (f) =>
              `<div class="flag is-${escape(f.severity)}"><code>${escape(f.code)}</code>` +
              `<span>${escape(f.detail ?? '')}</span></div>`,
          )
          .join('');
}

function renderSpans() {
  const limit = Number(state.episode?.measured_duration_seconds ?? 0);
  const merged = mergeSpans(state.spans, limit);
  const total = totalOf(merged);

  el.estimateDuration.textContent = fmtTime(total);
  const price = state.episode?.task?.price_per_minute;
  el.estimateAmount.textContent =
    price === undefined
      ? ''
      : `≈ ${((total / 60) * Number(price)).toFixed(2)} ${state.episode.task.currency}`;

  el.spans.innerHTML =
    state.spans.length === 0
      ? `<li class="spans-empty">${escape(t('mark.none'))}</li>`
      : state.spans
          .map(
            (s, index) =>
              `<li data-index="${index}">${fmtTime(s.start)}&nbsp;–&nbsp;${fmtTime(s.end)}` +
              `<button type="button" data-remove="${index}" aria-label="${escape(
                t('mark.clear'),
              )}">×</button></li>`,
          )
          .join('');

  const span = (s) => {
    const width = state.timeline.total > 0 ? ((s.end - s.start) / state.timeline.total) * 100 : 0;
    const left = state.timeline.total > 0 ? (s.start / state.timeline.total) * 100 : 0;
    return `<i style="left:${left}%;width:${Math.max(width, 0.3)}%"></i>`;
  };
  el.scrubSpans.innerHTML = merged.map(span).join('');
  renderPending();
}

function renderPending() {
  if (state.pendingIn === null || state.timeline.total <= 0) {
    el.scrubPending.hidden = true;
    return;
  }
  const now = currentEpisodeTime();
  const from = Math.min(state.pendingIn, now);
  const to = Math.max(state.pendingIn, now);
  el.scrubPending.hidden = false;
  el.scrubPending.style.left = `${(from / state.timeline.total) * 100}%`;
  el.scrubPending.style.width = `${Math.max(((to - from) / state.timeline.total) * 100, 0.3)}%`;
}

function renderParts() {
  const total = state.timeline.total;
  if (total <= 0) {
    el.scrubParts.innerHTML = '';
    return;
  }
  const ticks = state.timeline.offsets
    .slice(1)
    .map((offset) => `<i style="left:${(offset / total) * 100}%"></i>`);

  /**
   * The region past the payable window, if the container runs longer than the
   * measured duration. Measured duration is the *intersection* of stream
   * coverage — video that no IMU covers is not payable — so a reviewer marking
   * out there would have the span silently clamped by the server. Better to
   * show where the edge is.
   */
  const limit = Number(state.episode?.measured_duration_seconds ?? 0);
  if (limit > 0 && total - limit > 0.25) {
    ticks.push(`<i class="beyond" style="left:${(limit / total) * 100}%"></i>`);
  }
  el.scrubParts.innerHTML = ticks.join('');
}

function renderProgress() {
  const total = state.timeline.total;
  const now = currentEpisodeTime();
  el.time.textContent = `${fmtTime(now)} / ${fmtTime(total)}`;
  el.scrubHead.style.left = total > 0 ? `${(now / total) * 100}%` : '0%';
  el.scrub.setAttribute('aria-valuenow', String(Math.round(now)));
  el.scrub.setAttribute('aria-valuemax', String(Math.round(total)));
  el.partIndicator.textContent =
    state.timeline.parts.length > 1
      ? `${t('player.part')} ${state.partIndex + 1} ${t('player.of')} ${state.timeline.parts.length}`
      : '';
  el.play.textContent = state.live.paused ? t('player.play') : t('player.pause');
  el.rate.textContent = `${state.live.playbackRate.toFixed(2)}×`;
  renderBuffered();
  renderPending();
}

function renderBuffered() {
  const total = state.timeline.total;
  const video = state.live;
  if (total <= 0 || !video.buffered) return;
  const base = state.timeline.offsets[state.partIndex] ?? 0;
  const ranges = [];
  for (let i = 0; i < video.buffered.length; i += 1) {
    const from = (base + video.buffered.start(i)) / total;
    const to = (base + video.buffered.end(i)) / total;
    ranges.push(`<i style="left:${from * 100}%;width:${Math.max((to - from) * 100, 0.2)}%"></i>`);
  }
  el.scrubBuffered.innerHTML = ranges.join('');
}

function renderVerdict() {
  for (const [decision, node] of [
    ['good', $('verdict-good')],
    ['partial', $('verdict-partial')],
    ['bad', $('verdict-bad')],
  ]) {
    node.setAttribute('aria-checked', String(state.decision === decision));
  }
  el.reasonsWrap.hidden = state.decision !== 'bad' && state.decision !== 'partial';
  el.commit.disabled = state.decision === null || state.committing;
  el.commit.textContent = state.committing ? t('verdict.committing') : t('verdict.commit');
}

function renderReasons() {
  el.reasons.innerHTML = state.reasonCatalogue
    .map(
      (r) =>
        `<button class="reason" type="button" data-code="${escape(r.code)}" ` +
        `aria-pressed="${state.reasons.has(r.code)}">${escape(
          boot.locale === 'zh' ? (r.label_zh ?? r.label_en) : r.label_en,
        )}</button>`,
    )
    .join('');
}

function renderRecent(rows) {
  if (!rows || rows.length === 0) return;
  el.recent.innerHTML = rows
    .slice(0, 8)
    .map((r) => {
      const cls =
        r.reviewState === 'pass' ? 'pass' : r.reviewState === 'partial_pass' ? 'partial' : 'reject';
      return (
        `<li><span class="pill pill-${cls}">${escape(t(`verdict.${
          cls === 'pass' ? 'good' : cls === 'partial' ? 'partial' : 'bad'
        }`))}</span>` +
        `<span class="mono">${fmtSeconds(r.effective)}</span></li>`
      );
    })
    .join('');
}

function escape(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// ---------------------------------------------------------------------------
// Playback

const currentEpisodeTime = () =>
  state.timeline.toEpisode(state.partIndex, state.live.currentTime || 0);

function applyMediaDefaults(video) {
  // 2x is where most reviewing happens and pitch correction is what keeps
  // speech intelligible at it; without this a reviewer cannot judge audio at
  // all. The prefixed name is for older WebKit, which is what a reviewer on an
  // older iPad would be running.
  video.preservesPitch = true;
  video.webkitPreservesPitch = true;
  video.playbackRate = state.live.playbackRate || 1;
}

/** Seeks in episode time, switching part files when the target is in another. */
async function seekTo(episodeSeconds) {
  if (!state.timeline.ready || state.timeline.parts.length === 0) return;
  const target = state.timeline.locate(episodeSeconds);
  if (target.index !== state.partIndex) {
    state.partIndex = target.index;
    const wasPlaying = !state.live.paused;
    await loadPart(state.live, state.timeline.parts[target.index].url, target.offset);
    if (wasPlaying) void state.live.play().catch(() => {});
  } else {
    state.live.currentTime = target.offset;
  }
  renderProgress();
}

function loadPart(video, url, offset) {
  return new Promise((resolve) => {
    const ready = () => {
      video.removeEventListener('loadedmetadata', ready);
      if (offset > 0) video.currentTime = offset;
      applyMediaDefaults(video);
      resolve();
    };
    video.addEventListener('loadedmetadata', ready);
    video.src = url;
    video.load();
  });
}

function togglePlay() {
  if (state.live.paused) void state.live.play().catch(() => {});
  else state.live.pause();
  renderProgress();
}

function nudge(seconds) {
  void seekTo(currentEpisodeTime() + seconds);
}

function stepFrame(direction) {
  const fps = state.episode?.frame_rate ?? 30;
  state.live.pause();
  void seekTo(currentEpisodeTime() + direction / fps);
}

const RATES = [0.5, 0.75, 1, 1.5, 2, 3, 4];

function changeRate(direction) {
  const current = state.live.playbackRate;
  const index = RATES.findIndex((r) => Math.abs(r - current) < 0.01);
  const next = RATES[Math.min(RATES.length - 1, Math.max(0, (index < 0 ? 2 : index) + direction))];
  state.live.playbackRate = next;
  state.spare.playbackRate = next;
  renderProgress();
}

// ---------------------------------------------------------------------------
// Marking actions

function markIn() {
  state.pendingIn = currentEpisodeTime();
  el.markingHint.textContent = t('mark.pending');
  renderPending();
}

function markOut() {
  if (state.pendingIn === null) {
    el.markingHint.textContent = t('mark.orphanOut');
    return;
  }
  const now = currentEpisodeTime();
  const start = Math.min(state.pendingIn, now);
  const end = Math.max(state.pendingIn, now);
  state.pendingIn = null;
  el.markingHint.textContent = '';
  if (end - start <= 0) {
    renderSpans();
    return;
  }
  state.spans.push({ start, end });
  // Marking implies a partial verdict unless the reviewer has already said
  // otherwise, which saves a keystroke on the commonest path.
  if (state.decision === null) setDecision('partial');
  renderSpans();
  renderVerdict();
}

/** Removes whichever span contains the playhead. Nothing, quietly, if none does. */
function clearSpanAtPlayhead() {
  const now = currentEpisodeTime();
  const index = state.spans.findIndex((s) => now >= s.start && now <= s.end);
  if (index < 0) {
    state.pendingIn = null;
    renderPending();
    return;
  }
  state.spans.splice(index, 1);
  renderSpans();
}

function setDecision(decision) {
  state.decision = decision;
  el.verdictError.textContent = '';
  renderVerdict();
}

// ---------------------------------------------------------------------------
// Loading an episode

function resetForEpisode() {
  state.spans = [];
  state.pendingIn = null;
  state.decision = null;
  state.reasons.clear();
  state.partIndex = 0;
  el.note.value = '';
  el.markingHint.textContent = '';
  el.verdictError.textContent = '';
  renderReasons();
  renderVerdict();
}

/**
 * Puts an episode on screen.
 *
 * `alreadyLoaded` is the fast path: the element handed in is the spare one that
 * has been buffering this episode since the last advance, so nothing is
 * fetched and the swap is a visibility change.
 */
async function showEpisode(episode, { alreadyLoaded = false } = {}) {
  state.episode = episode;
  state.loadedAt = performance.now();
  resetForEpisode();
  clearScreen();
  renderMeta(episode);

  const parts = episode.media?.parts ?? [];
  state.timeline = new Timeline(parts);

  if (parts.length === 0) {
    showScreen('media');
    return;
  }

  if (!alreadyLoaded) {
    await loadPart(state.live, parts[0].url, 0);
  } else {
    applyMediaDefaults(state.live);
  }

  el.videoEmpty.hidden = true;
  renderParts();
  renderSpans();
  renderProgress();
  startHeartbeat();

  // Start playing straight away. The commit keystroke is the user gesture that
  // permits it; on the very first episode of a session there has been no
  // gesture yet, the browser refuses, and the reviewer presses space.
  void state.live.play().catch(() => {});

  // Durations resolve in the background; a single-part episode is instant and
  // a multi-part one is a metadata request per file.
  await state.timeline.measure(state.live);
  renderParts();
  renderProgress();

  void prefetchNext();
}

/**
 * Warms the next episode.
 *
 * `/api/review/next` deliberately does not claim: peeking at what is at the
 * head of the queue and taking it off somebody else's queue are different acts,
 * and a prefetch that claimed would idle every episode it touched for the
 * length of a lease.
 */
async function prefetchNext() {
  try {
    const { status, body } = await api('/api/review/next');
    if (status !== 200 || body === null) {
      state.prefetched = null;
      return;
    }
    state.prefetched = body;
    const first = body.media?.parts?.[0];
    if (first) {
      state.spare.preload = 'auto';
      state.spare.src = first.url;
      state.spare.load();
    }
  } catch {
    state.prefetched = null;
  }
}

function swapElements() {
  const outgoing = state.live;
  const incoming = state.spare;
  outgoing.classList.remove('is-live');
  incoming.classList.add('is-live');
  incoming.muted = false;
  outgoing.pause();
  outgoing.muted = true;
  state.live = incoming;
  state.spare = outgoing;
}

/** Claims the next episode outright. Used at start-up and after a correction. */
async function claimAndShow() {
  try {
    const { status, body } = await api('/api/review/claim', { method: 'POST' });
    if (status === 204) {
      state.episode = null;
      showScreen('empty');
      return;
    }
    if (status !== 200 || body === null) {
      showScreen('load', `HTTP ${status}`);
      return;
    }
    state.reviewId = body.review_id;
    updateStats(body);
    await showEpisode(body);
  } catch (err) {
    showScreen('load', String(err));
  }
}

function updateStats(body) {
  if (typeof body.queue_depth === 'number') el.queueDepth.textContent = String(body.queue_depth);
  if (body.session_average_seconds !== undefined) {
    el.queueAverage.textContent =
      body.session_average_seconds === null ? '—' : `${body.session_average_seconds.toFixed(1)}s`;
  }
}

// ---------------------------------------------------------------------------
// Committing

/**
 * Records the verdict and moves on.
 *
 * The advance is optimistic: the prefetched episode goes on screen at once and
 * the write is reconciled behind it, because waiting for a round trip on every
 * verdict is the throughput ceiling this screen exists to lift. What that costs
 * is a real rollback path, and the rollback is loud — the reviewer is put back
 * on the episode they judged, with their spans and their reasons intact, behind
 * a modal that cannot be worked past. Acceptance is explicit that a failed
 * commit must not advance past the episode, and a silently swallowed verdict is
 * a payment nobody ever notices is missing.
 */
async function commit() {
  if (state.committing || state.episode === null || state.blocked) return;
  /**
   * The previous advance put an episode on screen before its claim came back.
   * Committing on it before ownership is settled would be a verdict on an
   * episode this reviewer does not hold a lease for — a 409 and a rollback for
   * no reason. A reviewer fast enough to hit this waits one round trip.
   */
  if (state.claiming !== null) {
    await state.claiming.catch(() => {});
    state.claiming = null;
    if (state.episode === null || state.blocked) return;
  }
  const decision = state.decision;
  if (decision === null) return;

  const limit = Number(state.episode.measured_duration_seconds);
  const merged = mergeSpans(state.spans, limit);
  if (decision === 'partial' && merged.length === 0) {
    el.verdictError.textContent = t('mark.needsSpan');
    return;
  }
  if (decision === 'bad' && state.reasons.size === 0) {
    el.verdictError.textContent = t('verdict.reasonsRequired');
    return;
  }

  const attempt = {
    verdict_id: uuid(),
    episode_id: state.episode.episode_id,
    decision,
    spans: decision === 'partial' ? merged.map((s) => ({ start_seconds: s.start, end_seconds: s.end })) : [],
    reject_reasons: decision === 'good' ? [] : [...state.reasons],
    reviewer_note: el.note.value.trim() === '' ? null : el.note.value.trim(),
    time_to_verdict_seconds: (performance.now() - state.loadedAt) / 1000,
  };

  // Everything needed to put the reviewer back exactly where they were.
  const snapshot = {
    episode: state.episode,
    spans: [...state.spans],
    decision,
    reasons: new Set(state.reasons),
    note: el.note.value,
    timeline: state.timeline,
    partIndex: state.partIndex,
  };

  state.committing = true;
  renderVerdict();

  const warmed = state.prefetched;
  if (warmed !== null) {
    swapElements();
    state.prefetched = null;
    await showEpisode(warmed, { alreadyLoaded: true });
    // The claim follows the advance rather than gating it: the reviewer is
    // already watching by the time ownership is settled.
    state.claiming = reclaim(warmed.episode_id);
  } else {
    state.episode = null;
    el.videoEmpty.hidden = false;
  }

  try {
    const { status, body } = await post('/api/review/verdict', attempt);
    state.committing = false;
    if (status === 200 && body !== null) {
      updateStats(body);
      void refreshRecent();
      if (warmed === null) await claimAndShow();
      renderVerdict();
      return;
    }
    rollback(snapshot, attempt, describe(status, body));
  } catch (err) {
    state.committing = false;
    rollback(snapshot, attempt, String(err));
  }
}

const describe = (status, body) => (body && body.error ? `${body.error} (${status})` : `HTTP ${status}`);

/**
 * Takes ownership of the episode the advance has already put on screen.
 *
 * If the queue handed out something else in the meantime — another reviewer got
 * there first — the screen corrects visibly rather than letting the reviewer
 * judge footage they do not hold a lease on.
 */
async function reclaim(expectedEpisodeId) {
  const { status, body } = await api('/api/review/claim', { method: 'POST' });
  if (status === 204) {
    state.episode = null;
    showScreen('empty');
    return;
  }
  if (status !== 200 || body === null) {
    showScreen('load', `HTTP ${status}`);
    return;
  }
  state.reviewId = body.review_id;
  updateStats(body);
  if (body.episode_id !== expectedEpisodeId) await showEpisode(body);
}

function rollback(snapshot, attempt, detail) {
  // Give back the episode the optimistic advance claimed, so it is not held by
  // a screen that is about to go back to the previous one.
  if (state.episode && state.episode.episode_id !== snapshot.episode.episode_id) {
    void post(`/api/review/release/${state.episode.episode_id}`).catch(() => {});
  }

  state.episode = snapshot.episode;
  state.spans = snapshot.spans;
  state.decision = snapshot.decision;
  state.reasons = snapshot.reasons;
  state.timeline = snapshot.timeline;
  state.partIndex = snapshot.partIndex;
  el.note.value = snapshot.note;
  renderMeta(snapshot.episode);
  renderReasons();
  renderSpans();
  renderVerdict();
  renderParts();
  clearScreen();

  block({
    title: navigator.onLine ? t('state.writeFailed.title') : t('state.offline.title'),
    body: `${navigator.onLine ? t('state.writeFailed.body') : t('state.offline.body')} — ${detail}`,
    primary: t('state.writeFailed.retry'),
    onPrimary: async () => {
      // Same verdict_id. The endpoint is idempotent on it, so a retry after a
      // write that actually landed returns the original result rather than
      // writing a second review and a second payment.
      const { status, body } = await post('/api/review/verdict', attempt);
      if (status === 200 && body !== null) {
        unblock();
        updateStats(body);
        void refreshRecent();
        await claimAndShow();
      } else {
        el.blockerBody.textContent = `${t('state.writeFailed.body')} — ${describe(status, body)}`;
      }
    },
    secondary: t('state.writeFailed.release'),
    onSecondary: async () => {
      await post(`/api/review/release/${snapshot.episode.episode_id}`);
      unblock();
      await claimAndShow();
    },
  });
}

async function refreshRecent() {
  const { status, body } = await api('/api/review/recent');
  if (status === 200 && body) renderRecent(body.reviews);
}

// ---------------------------------------------------------------------------
// Lease

function startHeartbeat() {
  stopHeartbeat();
  state.heartbeat = setInterval(async () => {
    if (state.episode === null || state.blocked) return;
    const episodeId = state.episode.episode_id;
    const { status } = await post(`/api/review/heartbeat/${episodeId}`);
    if (status === 409) leaseLost();
  }, 60_000);
}

function stopHeartbeat() {
  if (state.heartbeat !== null) clearInterval(state.heartbeat);
  state.heartbeat = null;
}

function leaseLost() {
  stopHeartbeat();
  block({
    title: t('state.leaseExpired.title'),
    body: t('state.leaseExpired.body'),
    primary: t('state.leaseExpired.action'),
    onPrimary: async () => {
      unblock();
      await claimAndShow();
    },
  });
}

// ---------------------------------------------------------------------------
// Keyboard
//
// The whole point of the screen. Every binding below works with no pointer, and
// nothing here fires while focus is in a text field — a reviewer typing "1 in 3
// frames are dark" into the note must not set three verdicts.

const typing = (target) =>
  target instanceof HTMLElement &&
  (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

document.addEventListener('keydown', (event) => {
  if (typing(event.target)) {
    if (event.key === 'Escape') event.target.blur();
    return;
  }
  if (state.blocked && event.key !== '?') return;
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
      clearSpanAtPlayhead();
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
      event.preventDefault();
      void commit();
      return;
    case '?':
      el.shortcuts.hidden = !el.shortcuts.hidden;
      return;
    default:
  }
});

// ---------------------------------------------------------------------------
// Pointer

el.play.addEventListener('click', togglePlay);
el.markIn.addEventListener('click', markIn);
el.markOut.addEventListener('click', markOut);
el.markClear.addEventListener('click', clearSpanAtPlayhead);
el.commit.addEventListener('click', () => void commit());
el.shortcutsToggle.addEventListener('click', () => {
  el.shortcuts.hidden = !el.shortcuts.hidden;
});
$('verdict-good').addEventListener('click', () => setDecision('good'));
$('verdict-partial').addEventListener('click', () => setDecision('partial'));
$('verdict-bad').addEventListener('click', () => setDecision('bad'));
$('empty-retry').addEventListener('click', () => void claimAndShow());
$('load-retry').addEventListener('click', () => void claimAndShow());
$('media-skip').addEventListener('click', async () => {
  if (state.episode) await post(`/api/review/release/${state.episode.episode_id}`);
  await claimAndShow();
});

el.reasons.addEventListener('click', (event) => {
  const button = event.target.closest('[data-code]');
  if (!button) return;
  const code = button.dataset.code;
  if (state.reasons.has(code)) state.reasons.delete(code);
  else state.reasons.add(code);
  button.setAttribute('aria-pressed', String(state.reasons.has(code)));
  el.verdictError.textContent = '';
});

el.spans.addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove]');
  if (!button) return;
  state.spans.splice(Number(button.dataset.remove), 1);
  renderSpans();
});

/** Click anywhere on the bar to seek; drag the playhead to scrub. */
let scrubbing = false;
const scrubToPointer = (event) => {
  const box = el.scrub.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - box.left) / box.width));
  void seekTo(ratio * state.timeline.total);
};
el.scrub.addEventListener('pointerdown', (event) => {
  scrubbing = true;
  el.scrub.setPointerCapture(event.pointerId);
  scrubToPointer(event);
});
el.scrub.addEventListener('pointermove', (event) => {
  if (scrubbing) scrubToPointer(event);
});
el.scrub.addEventListener('pointerup', (event) => {
  scrubbing = false;
  el.scrub.releasePointerCapture(event.pointerId);
});
el.scrub.addEventListener('keydown', (event) => {
  if (event.key === 'Home') void seekTo(0);
  if (event.key === 'End') void seekTo(state.timeline.total);
});

// ---------------------------------------------------------------------------
// Media events

for (const video of [el.videoA, el.videoB]) {
  video.addEventListener('timeupdate', () => {
    if (video === state.live) renderProgress();
  });
  video.addEventListener('progress', () => {
    if (video === state.live) renderBuffered();
  });
  video.addEventListener('play', renderProgress);
  video.addEventListener('pause', renderProgress);
  video.addEventListener('error', () => {
    if (video === state.live && state.episode !== null) showScreen('media');
  });
  /** A part ending is not the episode ending unless it is the last one. */
  video.addEventListener('ended', () => {
    if (video !== state.live) return;
    if (state.partIndex + 1 < state.timeline.parts.length) {
      state.partIndex += 1;
      void loadPart(state.live, state.timeline.parts[state.partIndex].url, 0).then(() =>
        state.live.play().catch(() => {}),
      );
    }
    renderProgress();
  });
}

window.addEventListener('offline', () => {
  if (state.episode !== null && !state.blocked) {
    block({
      title: t('state.offline.title'),
      body: t('state.offline.body'),
      primary: t('queue.refresh'),
      onPrimary: () => {
        if (navigator.onLine) unblock();
      },
    });
  }
});
window.addEventListener('online', () => {
  if (state.blocked && el.blockerTitle.textContent === t('state.offline.title')) unblock();
});

/**
 * Best-effort release on the way out. `sendBeacon` is the only thing that
 * reliably survives an unload, and it cannot set headers — which is why the
 * session travels as a cookie as well as a header.
 */
window.addEventListener('pagehide', () => {
  if (state.episode !== null) {
    navigator.sendBeacon?.(`/api/review/release/${state.episode.episode_id}`);
  }
});

// ---------------------------------------------------------------------------
// Start

(async () => {
  applyMediaDefaults(el.videoA);
  applyMediaDefaults(el.videoB);
  const reasons = await api('/api/review/reasons');
  if (reasons.status === 200 && reasons.body) {
    state.reasonCatalogue = reasons.body.reasons;
    renderReasons();
  }
  void refreshRecent();
  await claimAndShow();
})();
