/**
 * `expo-video`, for the browser harness only.
 *
 * Same rule as the two stubs beside this file: it pretends nothing it cannot
 * do. The difference is that a browser genuinely HAS video, so this one is not
 * a thrower — it is the same `<video>` element the console's `/discover` uses,
 * behind the surface `Landing.tsx` calls on the phone. The harness therefore
 * screenshots a landing whose film really plays, which is the whole point of
 * shooting the app beside the console.
 *
 * Only what `Landing.tsx` touches is implemented: `useVideoPlayer(source,
 * setup)`, the player's `muted`, `loop`, `status`, `play()` and
 * `addListener('statusChange')`, and `<VideoView player contentFit style>`.
 * Anything else is deliberately absent so that reaching for it fails here
 * rather than silently doing nothing.
 *
 * It never ships. `vite.config.ts` in this directory is the only thing that
 * points at it.
 */
import { useEffect, useRef, useState } from 'react';

type Status = 'idle' | 'loading' | 'readyToPlay' | 'error';
type Listener = (payload: { status: Status }) => void;

/**
 * The player, which in a browser is a handle on a `<video>` the view mounts.
 *
 * The element does not exist until `VideoView` renders, so the handle carries
 * the properties that were set before it and applies them on attach. That is
 * the same ordering the native module has — `useVideoPlayer`'s setup callback
 * runs before any view is mounted — so the seam behaves the same way in both.
 */
class StubVideoPlayer {
  muted = false;
  loop = false;
  status: Status = 'idle';
  element: HTMLVideoElement | null = null;
  private wanted = false;
  private listeners = new Set<Listener>();

  constructor(readonly src: string) {}

  play() {
    this.wanted = true;
    void this.element?.play().catch(() => this.emit('error'));
  }

  pause() {
    this.wanted = false;
    this.element?.pause();
  }

  addListener(event: 'statusChange', listener: Listener) {
    if (event !== 'statusChange') throw new Error(`expo-video stub: no ${event} event`);
    this.listeners.add(listener);
    return { remove: () => this.listeners.delete(listener) };
  }

  /** Called by `VideoView` when its element appears or goes away. */
  attach(element: HTMLVideoElement | null) {
    this.element = element;
    if (!element) return;
    element.muted = this.muted;
    element.loop = this.loop;
    const ready = () => this.emit('readyToPlay');
    element.addEventListener('canplay', ready);
    element.addEventListener('error', () => this.emit('error'));
    if (element.readyState >= 3) ready();
    if (this.wanted) void element.play().catch(() => this.emit('error'));
  }

  private emit(status: Status) {
    this.status = status;
    for (const listener of this.listeners) listener({ status });
  }
}

export type VideoPlayer = StubVideoPlayer;
export type VideoContentFit = 'contain' | 'cover' | 'fill';

/**
 * One player per source, for the life of the component. Metro hands the native
 * module an asset; Vite hands this a URL string, and both are `source` here.
 */
export function useVideoPlayer(
  source: string | number | { uri: string },
  setup?: (player: StubVideoPlayer) => void,
): StubVideoPlayer {
  const uri =
    typeof source === 'string' ? source : typeof source === 'number' ? '' : source.uri;
  const [player] = useState(() => {
    const created = new StubVideoPlayer(uri);
    setup?.(created);
    return created;
  });
  return player;
}

export function VideoView({
  player,
  contentFit = 'contain',
  style,
  ...rest
}: {
  player: StubVideoPlayer | null;
  contentFit?: VideoContentFit;
  nativeControls?: boolean;
  style?: Record<string, unknown> | Record<string, unknown>[];
  [key: string]: unknown;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  useEffect(() => {
    player?.attach(ref.current);
    return () => player?.attach(null);
  }, [player]);
  // `StyleSheet.absoluteFill` is what every call site passes, and it is the
  // same four numbers in react-native-web as in CSS. Flattening it by hand
  // keeps this stub free of a react-native-web import.
  const flat = Object.assign({}, ...[style].flat().filter(Boolean)) as Record<string, unknown>;
  return (
    <video
      ref={ref}
      src={player?.src}
      playsInline
      aria-label={typeof rest['accessibilityLabel'] === 'string' ? rest['accessibilityLabel'] : undefined}
      /*
       * `width` and `height` are explicit, and they are the whole difference
       * between this stub and the native view.
       *
       * `<video>` is a replaced element, and an absolutely positioned replaced
       * element whose width and height are both `auto` takes its INTRINSIC
       * size and lets `right`/`bottom` be over-constrained — so
       * `StyleSheet.absoluteFill`, which is exactly `inset: 0`, sized the film
       * at 1280x716 in the top-left corner of a 390x844 screen. Measured on
       * the first likeness sheet: a hard edge across the landing at 716px with
       * bare ink under it, where the phone shows film to the bottom of the
       * screen. `VideoView` on the phone is an ordinary view and has never had
       * this; the fault was only ever here.
       */
      style={{ ...flat, width: '100%', height: '100%', objectFit: contentFit === 'fill' ? 'fill' : contentFit } as never}
    />
  );
}
