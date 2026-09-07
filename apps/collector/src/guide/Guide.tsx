import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Text, View, useWindowDimensions } from 'react-native';
import { useNav, isTabRootName, type TabName } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import type { MessageKey } from '../i18n.ts';
import { PandaPointer } from '../identity/Panda.tsx';
import { Body, Button, Title, bottomInset, face } from '../ui.tsx';
import { guideOffered } from './seen.ts';

/**
 * The coach-mark tour.
 *
 * It is **optional, dismissible, and offered once**. It never auto-starts, it
 * never blocks a screen a collector arrived at to do something, and every step
 * points at a real element that is on screen at that moment — a step whose
 * target has not been measured is skipped rather than drawn over nothing.
 *
 * Steps belong to a tab root, because those are the four places a collector
 * lands. A screen registers its targets with `useGuideTarget(key)` and the
 * overlay measures them with `measureInWindow`; nothing is hard-coded to a
 * coordinate, so a step still points at the right thing after the text wraps
 * differently in Vietnamese than in English.
 *
 * The scrim is four Views around the hole rather than one View with a mask —
 * React Native core has no mask, and four rectangles is what "cut a hole in a
 * dark sheet" actually is on this platform.
 */

interface Step {
  /** Matches the key a screen passes to `useGuideTarget`. */
  target: string;
  copy: MessageKey;
}

const STEPS: Record<TabName, Step[]> = {
  home: [
    { target: 'home.ring', copy: 'guide.home.ring' },
    { target: 'home.tasks', copy: 'guide.home.tasks' },
    { target: 'shell.tabs', copy: 'guide.home.tabs' },
  ],
  taskHall: [{ target: 'hall.list', copy: 'guide.tasks.list' }],
  uploads: [{ target: 'uploads.list', copy: 'guide.uploads.confirm' }],
  income: [{ target: 'income.list', copy: 'guide.income.split' }],
};

interface Measurable {
  measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void;
}

interface GuideApi {
  /** True while the one-time offer card should be on the home screen. */
  offered: boolean;
  /** Start the tour for the current tab root. Also answers the offer. */
  accept: () => void;
  /** Turn the offer down; it is not shown again. */
  decline: () => void;
  register: (key: string, node: Measurable | null) => void;
}

const GuideContext = createContext<GuideApi | null>(null);

export function useGuide(): GuideApi {
  const api = useContext(GuideContext);
  if (api === null) throw new Error('useGuide outside GuideProvider');
  return api;
}

/**
 * Attach the returned ref to the View a step points at.
 *
 * The View needs `collapsable={false}` on Android or the platform may flatten
 * it out of the tree to save a node, and a View that is not in the tree cannot
 * be measured.
 */
export function useGuideTarget(key: string) {
  const { register } = useGuide();
  return useCallback(
    (node: Measurable | null) => {
      register(key, node);
    },
    [register, key],
  );
}

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function GuideProvider({ children }: { children: ReactNode }) {
  const [offered, setOffered] = useState(false);
  const [running, setRunning] = useState(false);
  const targets = useRef(new Map<string, Measurable>());

  useEffect(() => {
    let live = true;
    void guideOffered.get().then((seen) => {
      if (live && !seen) setOffered(true);
    });
    return () => {
      live = false;
    };
  }, []);

  const answer = () => {
    setOffered(false);
    void guideOffered.set();
  };

  const api = useMemo<GuideApi>(
    () => ({
      offered,
      accept: () => {
        answer();
        setRunning(true);
      },
      decline: answer,
      register: (key, node) => {
        if (node === null) targets.current.delete(key);
        else targets.current.set(key, node);
      },
    }),
    [offered],
  );

  return (
    <GuideContext.Provider value={api}>
      {children}
      {running ? (
        <GuideOverlay targets={targets.current} onClose={() => setRunning(false)} />
      ) : null}
    </GuideContext.Provider>
  );
}

function GuideOverlay({
  targets,
  onClose,
}: {
  targets: Map<string, Measurable>;
  onClose: () => void;
}) {
  const theme = useTheme();
  const tt = useT();
  const nav = useNav();
  const { width, height } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);

  const tab: TabName = isTabRootName(nav.route.name) ? nav.route.name : 'home';
  const steps = STEPS[tab];
  const step = steps[index];

  // Measure the current step's target. A target that is not mounted — a legend
  // that has not loaded, a list that is still empty — measures to nothing, and
  // the step then draws its card with no hole rather than a hole over the
  // wrong element.
  useEffect(() => {
    if (step === undefined) return;
    const node = targets.get(step.target);
    if (node === undefined) {
      setBox(null);
      return;
    }
    node.measureInWindow((x, y, w, h) => {
      setBox(w > 0 && h > 0 ? { x, y, w, h } : null);
    });
  }, [index, step, targets]);

  if (step === undefined) return null;

  const pad = theme.space[2];
  const hole: Box | null =
    box === null
      ? null
      : { x: box.x - pad, y: box.y - pad, w: box.w + pad * 2, h: box.h + pad * 2 };

  /**
   * The card goes into whichever gap around the cut-out is the taller one.
   *
   * Pinning it to an edge rather than floating it beside the hole is what keeps
   * it whole: the card's height depends on how the sentence wraps, in two
   * languages, at whatever text size the collector has set, and a card placed
   * by arithmetic on a height nobody has measured is a card that loses its
   * first line off the top of the screen. This one cannot.
   *
   * Which edge was decided by "does the whole cut-out sit in the top half",
   * and that is the wrong question: a tall target fails it while still leaving
   * far more room below it than above, so the card went to the top and covered
   * the thing the step was pointing at. Comparing the two gaps cannot do that.
   */
  const below = hole === null || height - (hole.y + hole.h) >= hole.y;
  const scrim = theme.color.stage.ground;

  const sheet = (style: object) => (
    <View
      pointerEvents="auto"
      style={{ position: 'absolute', backgroundColor: scrim, opacity: 0.66, ...style }}
    />
  );

  return (
    <View
      accessibilityViewIsModal
      style={{ position: 'absolute', left: 0, top: 0, width, height }}
    >
      {hole === null ? (
        sheet({ left: 0, top: 0, width, height })
      ) : (
        <>
          {sheet({ left: 0, top: 0, width, height: Math.max(hole.y, 0) })}
          {sheet({ left: 0, top: hole.y + hole.h, width, height })}
          {sheet({ left: 0, top: hole.y, width: Math.max(hole.x, 0), height: hole.h })}
          {sheet({ left: hole.x + hole.w, top: hole.y, width, height: hole.h })}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: hole.x,
              top: hole.y,
              width: hole.w,
              height: hole.h,
              borderRadius: theme.radius.base,
              borderWidth: 2,
              borderColor: theme.color.sun[500],
            }}
          />
        </>
      )}

      {/* Trúc points at the cut-out from whichever side has room for him. */}
      {hole === null ? null : (
        <PandaPointer
          x={
            hole.x > width / 2
              ? Math.max(hole.x - theme.space[16], theme.space[4])
              : Math.min(hole.x + hole.w, width - theme.space[16] - theme.space[4])
          }
          // Always at the end of the cut-out the card is NOT at, so he is
          // never behind it.
          y={
            below
              ? Math.max(hole.y - theme.space[10], theme.space[6])
              : hole.y + hole.h - theme.space[10]
          }
          size={theme.space[16]}
          flip={hole.x > width / 2}
        />
      )}

      <View
        style={{
          position: 'absolute',
          left: theme.space[4],
          right: theme.space[4],
          ...(below
            ? { bottom: theme.space[6] + bottomInset(theme.space[6]) }
            : { top: theme.space[16] }),
          backgroundColor: theme.color.card,
          borderRadius: theme.radius.base,
          padding: theme.space[4],
          gap: theme.space[3],
        }}
      >
        <Text
          style={{
            color: theme.color.mutedForeground,
            fontFamily: face(theme),
            fontSize: theme.fontSize.xs,
            fontVariant: ['tabular-nums'],
          }}
        >
          {tt('guide.step')} {index + 1}/{steps.length}
        </Text>
        <Title>{tt('guide.open')}</Title>
        <Body>{tt(step.copy)}</Body>
        <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
          {index > 0 ? (
            <View style={{ flexGrow: 1 }}>
              <Button
                variant="ghost"
                label={tt('common.back')}
                onPress={() => setIndex((i) => i - 1)}
              />
            </View>
          ) : (
            <View style={{ flexGrow: 1 }}>
              <Button variant="ghost" label={tt('common.close')} onPress={onClose} />
            </View>
          )}
          <View style={{ flexGrow: 1 }}>
            <Button
              label={index === steps.length - 1 ? tt('common.done') : tt('common.next')}
              onPress={() => (index === steps.length - 1 ? onClose() : setIndex((i) => i + 1))}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
