import { CardScrollContext } from '../ui/CardSheen.tsx';
import { Failure } from '../ui/StatePanel.tsx';
import { useToast } from '../ui/Toast.tsx';
import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { Image, type ImageSource } from 'expo-image';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav, useRoute } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import {
  Body,
  Button,
  Card,
  Loading,
  Header,
  Progress,
  Row,
  Scrim,
  Tag,
  face,
  useInsets,
  useReducedMotion,
} from '../ui.tsx';
import { taskImage } from '../ui/taskImage.ts';
import { dong } from '../money.ts';
import type { MessageKey } from '../i18n.ts';

/**
 * Work order §4.5 — one task, one decision.
 *
 * Copies klarna-181/189's card stack: a tinted head with the mark, the name
 * and the figure, then separate rounded cards of label/value rows with their
 * own section headings and hairlines between rows. The confirm-summary shape
 * under "Task rates" is `12-confirm-review` (wise-472): a heading over a rule,
 * then rows, then one commit control.
 *
 * The head is the task's photograph under a measured scrim rather than
 * klarna-181's colour wash: SPEC.md spends the gradient on three surfaces and
 * task cards are photo-led (§2), so this screen's head is the same still the
 * Explore card showed and the collector recognises what they tapped.
 *
 * **There is no projected total and there never will be.** `unitPrice ×
 * targetMinutes` is the client computing money and the answer is a figure the
 * server never promised (CLAUDE.md, §0.8). "Task rates" is the rate, the
 * target, what is already taken and the places left — every one of them a
 * field as sent — and one sentence saying where the real figure comes from.
 */

/**
 * The server's refusal, in the collector's language.
 *
 * Anything unrecognised falls back to a generic sentence rather than showing a
 * Vietnamese collector an English error code (LOC-01).
 */
const CLAIM_ERRORS: Record<string, MessageKey> = {
  // open sign-up
  collector_not_onboarded: 'detail.needOnboarding',
  exam_not_passed: 'detail.needExam',
  agreements_incomplete: 'detail.needAgreements',
  training_incomplete: 'detail.needTraining',
  task_at_capacity: 'detail.full',
  already_claimed: 'detail.claimed',
  not_qualified: 'detail.notQualified',
  task_not_claimable: 'detail.unavailable',
};

const claimErrorKey = (error: unknown): MessageKey =>
  CLAIM_ERRORS[error instanceof Error ? error.message : ''] ?? 'common.actionFailed';

/**
 * The falloff under the type on the head, as `Scrim` stops.
 *
 * Kept from the screen this replaces, where it was measured on the emulator at
 * 390×844 against `pov-portrait`: four bands of 25% stepped visibly and read
 * as lines, and these eight points on the same curve do not. `Scrim`
 * interpolates them over forty bands, so the ramp is smoother than the eight
 * it is drawn from. Shallower than sign-in's, because the only thing over it
 * is a title and a back control that each stand on their own ground.
 */
const HEAD_SCRIM = [
  [0.0, 0.02],
  [0.14, 0.05],
  [0.28, 0.09],
  [0.42, 0.15],
  [0.57, 0.23],
  [0.71, 0.34],
  [0.85, 0.48],
  [1.0, 0.66],
] as const;

export function TaskDetail() {
  const api = useApi();
  const toast = useToast();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const insets = useInsets();
  const c = theme.collector;
  const { taskId } = useRoute('taskDetail');
  const queryClient = useQueryClient();
  /** The sticky footer's own measured height, so content clears it exactly. */
  const [footer, setFooter] = useState(0);

  const scrollY = useRef(new Animated.Value(0)).current;
  const reduced = useReducedMotion();
  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => api.task(taskId) });
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const claims = useQuery({ queryKey: ['claims'], queryFn: () => api.myClaims() });

  const mounted = useRef(true);
  const submitting = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const claim = useMutation({
    mutationFn: () => api.claimTask(taskId),
    onSettled: () => { submitting.current = false; },
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      if (mounted.current) { toast(tt('detail.claimed')); nav.push({ name: 'sessionReminder' }); }
    },
  });

  const ground = { flex: 1, backgroundColor: c.paper };

  /**
   * A failed read is a different screen from a pending one.
   *
   * All three queries, not only the task: `profile` decides the exam gate and
   * `claims` decides whether this task is already taken, so a failed read of
   * either would turn "we do not know" into a business answer. Unknown state
   * offers a retry, never an action.
   */
  if ([task, profile, claims].some((query) => query.isError)) {
    return (
      <View style={ground}>
        <View style={{ padding: c.gutter, paddingTop: insets.top + theme.space[4] }}>
          <Header title={tt('detail.title')} />
          <Failure error={[task, profile, claims].find(query => query.isError)?.error}
            text={tt('common.loadFailed')}
            tone="error"
            busy={task.isFetching || profile.isFetching || claims.isFetching}
            onRetry={() => {
              void task.refetch();
              void profile.refetch();
              void claims.refetch();
            }}
          />
        </View>
      </View>
    );
  }

  if (task.data === undefined || profile.data === undefined || claims.data === undefined) {
    return (
      <View style={ground}>
        <View style={{ padding: c.gutter, paddingTop: insets.top + theme.space[4] }}>
          <Loading kind="body" />
        </View>
      </View>
    );
  }

  const data = task.data;
  const examPassed = profile.data !== null && profile.data.examPassed;
  /**
   * Open sign-up: false only for somebody who signed up in the app and has not
   * been to a collection centre. `http.ts` reads it as true when the server
   * does not send it, so an older deployment behaves as it always did.
   */
  const onboarded = profile.data === null || profile.data.onboarded;
  const alreadyClaimed = data.claimedByMe || claims.data.some((row) => row.taskId === taskId);
  const full = data.claimants >= data.maxClaimants;
  const taken = data.targetMinutes <= 0 ? 0 : data.claimedMinutes / data.targetMinutes;

  /**
   * §4.5: the Accept control is **replaced** by the reason it cannot be
   * pressed, not merely disabled.
   *
   * Each of these is a refusal name the server also uses, and the app does not
   * guess which applies — the server's own answer, when it arrives, wins over
   * every one of them.
   */
  const refusal: MessageKey | null = claim.isError
    ? claimErrorKey(claim.error)
    : alreadyClaimed
      ? 'detail.claimed'
      : // Before the exam, because the exam does not unlock this one: the
        // server's prospect gate runs first and a centre is what clears it.
        !onboarded
        ? 'detail.needOnboarding'
        : !examPassed
        ? 'detail.needExam'
        : full
          ? 'detail.full'
          : !data.published || !data.claimable
            ? 'detail.unavailable'
            : null;

  const section = (title: MessageKey, text: string) => (
    <Card key={title}>
      <Text
        accessibilityRole="header"
        style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2 }}
      >
        {tt(title)}
      </Text>
      <Body>{text.trim() === '' ? tt('detail.notSupplied') : text}</Body>
    </Card>
  );

  return (
    <CardScrollContext.Provider value={scrollY}><View style={ground}>
      <Animated.ScrollView scrollEventThrottle={16} onScroll={reduced ? undefined : Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: Platform.OS !== 'web' })}
        contentContainerStyle={{ paddingBottom: footer + theme.space[6], gap: c.cardGap }}
      >
        {/* The task card photo remains 4:3 here, with scroll-driven parallax. */}
        <View style={{ width: '100%', aspectRatio: 4 / 3, backgroundColor: c.line, overflow: 'hidden' }}>
          <Animated.View style={{ width: '100%', height: '100%', transform: [{ translateY: reduced ? 0 : scrollY.interpolate({ inputRange: [0, 600], outputRange: [0, 180], extrapolate: 'clamp' }) }] }}><Image
            // `assets.d.ts` types a bundled import as React Native's source —
            // a module number under Metro, a URL string under Vite — and
            // `expo-image` takes both. The cast is that one fact.
            source={taskImage(data) as unknown as ImageSource}
            contentFit="cover"
            style={{ width: '100%', height: '100%' }}
            accessible={false}
          />
          </Animated.View>
          <Scrim stops={HEAD_SCRIM} />
          <View
            style={{
              position: 'absolute',
              left: c.gutter,
              right: c.gutter,
              top: insets.top + theme.space[2],
            }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={tt('common.back')}
              onPress={nav.back}
              style={({ pressed }) => ({
                minWidth: theme.space[12],
                minHeight: theme.space[12],
                borderRadius: c.radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: c.surface,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme) }}>←</Text>
            </Pressable>
          </View>
          <View
            style={{ position: 'absolute', left: c.gutter, right: c.gutter, bottom: c.cardPad }}
          >
            <Text
              accessibilityRole="header"
              style={{
                ...c.type.h1,
                color: c.surface,
                fontFamily: face(theme),
                letterSpacing: -0.5,
              }}
            >
              {data.title}
            </Text>
          </View>
        </View>

        <View style={{ paddingHorizontal: c.gutter, gap: c.cardGap }}>
          {/* The rate, in the money green ink shade and the largest figure on
              the screen. §2 puts rates in green; `greenInk` is the shade that
              passes AA on white, which `contrast.test.ts` holds. */}
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', gap: theme.space[2] }}>
              <Text
                style={{
                  ...c.type.display,
                  color: c.greenInk,
                  fontFamily: face(theme),
                  fontVariant: ['tabular-nums'],
                }}
              >
                {dong(data.unitPriceVndPerMinute)}
              </Text>
              <Text style={{ ...c.type.caption, color: c.muted, fontFamily: face(theme), flexShrink: 1 }}>
                {tt('hall.perMinute')}
              </Text>
            </View>
            <Body muted>{tt('hall.pricePerMinute')}</Body>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
              {data.scenario === null && (data.type ?? '') === '' ? null : (
                <Tag
                  label={data.scenario === null ? (data.type ?? '') : tt(`scenario.${data.scenario}`)}
                  fg={c.muted}
                  bg={c.paper}
                />
              )}
              <Tag
                label={alreadyClaimed ? tt('detail.claimed') : full ? tt('hall.full') : tt('hall.open')}
                fg={alreadyClaimed ? c.greenInk : full ? c.redInk : c.plum}
                bg={alreadyClaimed ? c.greenBg : full ? c.redBg : c.paper}
              />
            </View>
          </Card>

          {section('detail.instructions', data.instructions)}

          {/* "Task rates": server numbers only. The sentence under the rows is
              there because the obvious missing row is a total, and saying why
              it is missing is better than leaving the collector to multiply. */}
          <Card>
            <Text
              accessibilityRole="header"
              style={{ ...c.type.h2, color: c.ink, fontFamily: face(theme), letterSpacing: -0.2 }}
            >
              {tt('detail.rates')}
            </Text>
            <Row label={tt('hall.perMinute')} value={dong(data.unitPriceVndPerMinute)} />
            <Row label={tt('detail.target')} value={`${data.targetMinutes} ${tt('detail.minutes')}`} />
            <Row label={tt('detail.claimedMinutes')} value={`${data.claimedMinutes} ${tt('detail.minutes')}`} />
            <Row label={tt('detail.slotsLeft')} value={`${data.remainingSlots}`} />
            <Progress
              label={tt('hall.progress')}
              value={`${data.claimedMinutes}/${data.targetMinutes}`}
              fraction={taken}
            />
            <Body muted>{tt('detail.noTotal')}</Body>
            <Body muted>{data.paymentRule.trim() === '' ? tt('detail.notSupplied') : data.paymentRule}</Body>
          </Card>

          {section('detail.where', data.privacyNotice)}
        </View>
      </Animated.ScrollView>

      {/* Sticky Accept, green because §2 makes affirmative green and this is
          the one affirmative action in the app. Its refusal takes its place. */}
      <View
        onLayout={(event) => setFooter(event.nativeEvent.layout.height)}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: c.paper,
          borderTopWidth: 1,
          borderTopColor: c.line,
          paddingHorizontal: c.gutter,
          paddingTop: theme.space[3],
          paddingBottom: theme.space[3] + Math.max(insets.bottom, theme.space[6]),
          gap: theme.space[2],
        }}
      >
        {refusal === null ? (
          <Button
            label={tt('detail.claim')}
            variant="affirmative"
            busy={claim.isPending}
            onPress={() => { if (submitting.current) return; submitting.current = true; claim.mutate(); }}
          />
        ) : claim.isError ? <Failure error={claim.error} text={tt(refusal)} onRetry={() => { if (!submitting.current) { submitting.current = true; claim.mutate(); } }} busy={claim.isPending} /> : (
          <View accessibilityLiveRegion="polite">
            <Text
              style={{
                ...c.type.body,
                color: c.muted,
                fontFamily: face(theme),
                textAlign: 'center',
              }}
            >
              {tt(refusal)}
            </Text>
          </View>
        )}
        {alreadyClaimed ? (
          <Button
            label={tt('session.title')}
            variant="secondary"
            onPress={() => nav.push({ name: 'sessionCreate' })}
          />
        ) : null}
      </View>
    </View></CardScrollContext.Provider>
  );
}
