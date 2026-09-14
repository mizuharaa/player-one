import { useState } from 'react';
import { Animated, Pressable, ScrollView, Text, View } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav, useRoute } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Button, Row, bottomInset, topInset, useReducedMotion } from '../ui.tsx';
import {
  ImageBox,
  ImageLabel,
  LimeTrack,
  LoadFailed,
  Scrim,
  Skeleton,
  taskImage,
  textStyle,
} from '../v2.tsx';
import { dong } from '../money.ts';
import type { MessageKey } from '../i18n.ts';

/**
 * The server's refusal, in the collector's language. Anything unrecognised
 * falls back to a generic message rather than showing an English error code
 * to a Vietnamese collector (LOC-01).
 */
const CLAIM_ERRORS: Record<string, MessageKey> = {
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
 * SPEC §12. One task, one decision: a hero still, a prominent price, the
 * server's three sentences, and exactly one primary action.
 *
 * **The price sits on the card's own ground, in ink — not on plum.** §0.2's
 * rule is that a money figure is anchored by size and never by a coloured box,
 * and `unitPriceVndPerMinute` at `fontSize.2xl` is the largest figure on this
 * screen. Plum is for a rate chip that has to survive being laid over a
 * photograph (§10); here there is no photograph under it and no legibility
 * problem to solve, so the tint would be decoration. The claim track therefore
 * moves out of the price card into a row of its own, so the lime is read as
 * *the task filling up* and not as part of the price.
 *
 * **The inline unit beside the figure is the short one.** `hall.pricePerMinute`
 * is 36 characters and sharing a baseline row with a 33px figure broke
 * "4.500 đ" across two lines in the mock, so the row carries `hall.perMinute`
 * and the full sentence sits underneath at `fontSize.xs`. Both strings already
 * exist and neither is reworded.
 *
 * **There is no estimated-earnings calculator here and there never will be.**
 * Multiplying the unit price by the target minutes is the client computing
 * money, and the result is a number the server never promised (§0.8).
 */
export function TaskDetail() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const reduced = useReducedMotion();
  const { taskId } = useRoute('taskDetail');
  const queryClient = useQueryClient();
  /** The footer's own measured height, so content can clear it exactly. */
  const [footer, setFooter] = useState(0);
  const scroll = useState(() => new Animated.Value(0))[0];

  const task = useQuery({ queryKey: ['task', taskId], queryFn: () => api.task(taskId) });
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const claims = useQuery({ queryKey: ['claims'], queryFn: () => api.myClaims() });

  const claim = useMutation({
    mutationFn: () => api.claimTask(taskId),
    onSuccess: async () => {
      await queryClient.invalidateQueries();
      nav.push({ name: 'myTasks' });
    },
  });

  const ground = { flex: 1, backgroundColor: theme.color.discover.paper };

  // A failed query is a different screen from a pending one, and the error one
  // has a button. All three queries, not just the task: `profile` decides the
  // exam gate and `claims` decides whether this task is already claimed, so a
  // failed read of either would become a business answer when the truth is
  // "we do not know". Unknown state offers a retry, never an action.
  if ([task, profile, claims].some((q) => q.isError)) {
    return (
      <View style={ground}>
        <View style={{ padding: theme.space[4], paddingTop: topInset(theme.space[6]) + theme.space[4] }}>
          <LoadFailed
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
        <View style={{ gap: theme.space[4] }}>
          <Skeleton ratio={3 / 2} radius={0} />
          <View style={{ paddingHorizontal: theme.space[4], gap: theme.space[3] }}>
            <Skeleton lines={5} radius={theme.radius.lg} />
            <Skeleton lines={3} radius={theme.radius.lg} />
          </View>
        </View>
      </View>
    );
  }

  const data = task.data;
  const examPassed = profile.data !== null && profile.data.examPassed;
  const alreadyClaimed = data.claimedByMe || claims.data.some((c) => c.taskId === taskId);
  const full = data.claimants >= data.maxClaimants;
  const done =
    data.targetMinutes <= 0 ? 0 : Math.min(1, data.claimedMinutes / data.targetMinutes);

  /**
   * §12: the pill is **replaced** by the reason it cannot be pressed, not
   * merely disabled. Each of these is a refusal name the server also uses, and
   * the app does not guess which applies — the server's own answer, when it
   * arrives, wins over every one of them.
   */
  const refusal: MessageKey | null = claim.isError
    ? claimErrorKey(claim.error)
    : alreadyClaimed
      ? 'detail.claimed'
      : !examPassed
        ? 'detail.needExam'
        : full
          ? 'detail.full'
          : !data.published || !data.claimable
            ? 'detail.unavailable'
            : null;

  const label = { ...textStyle(theme, 'caption'), color: theme.color.discover.muted };
  const body = { ...textStyle(theme, 'body'), color: theme.color.discover.ink };

  const section = (title: MessageKey, text: string) => (
    <View style={{ gap: theme.space[1] }}>
      <Text style={label}>{tt(title)}</Text>
      <Text style={body}>{text === '' ? tt('detail.notSupplied') : text}</Text>
    </View>
  );

  return (
    <View style={ground}>
      <ScrollView
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scroll } } }], {
          useNativeDriver: true,
        })}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingBottom: footer + theme.space[6], gap: theme.space[4] }}
      >
        {/* 3/2 rather than 16/9 so that at 320×640 the price field is above the
            fold without letterboxing the image (§12). */}
        <Animated.View
          style={{
            transform: [
              {
                // 0.4× parallax on the native driver — `opacity` and
                // `transform` only, per §0.5 rule 4. Reduced motion holds it
                // still; nothing about the layout depends on it moving.
                translateY: reduced
                  ? 0
                  : scroll.interpolate({
                      inputRange: [0, PARALLAX_RANGE],
                      outputRange: [0, PARALLAX_RANGE * PARALLAX_RATE],
                      extrapolateLeft: 'clamp',
                    }),
              },
            ],
          }}
        >
          <ImageBox source={taskImage(data.scenario, data.type)} ratio={3 / 2}>
            <Scrim />
            <View
              style={{
                position: 'absolute',
                left: theme.space[4],
                right: theme.space[4],
                top: topInset(theme.space[6]) + theme.space[2],
                flexDirection: 'row',
                alignItems: 'flex-start',
                justifyContent: 'space-between',
                gap: theme.space[3],
              }}
            >
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={tt('common.back')}
                onPress={nav.back}
                style={({ pressed }) => ({
                  minWidth: theme.space[12],
                  minHeight: theme.space[12],
                  borderRadius: theme.radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: theme.color.discover.surface,
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <Text style={{ ...textStyle(theme, 'section'), color: theme.color.discover.ink }}>←</Text>
              </Pressable>
              <ImageLabel floating />
            </View>
            <View
              style={{
                position: 'absolute',
                left: theme.space[4],
                right: theme.space[4],
                bottom: theme.space[4],
              }}
            >
              <Text
                style={{
                  ...textStyle(theme, 'title'),
                  color: theme.color.stage.over,
                  fontWeight: theme.fontWeight.display,
                }}
              >
                {data.title}
              </Text>
            </View>
          </ImageBox>
        </Animated.View>

        <View style={{ paddingHorizontal: theme.space[4], gap: theme.space[4] }}>
          {/* The price card: `discover.surface`, and the figure in ink. */}
          <View
            style={{
              backgroundColor: theme.color.discover.surface,
              borderRadius: theme.radius.lg,
              padding: theme.space[4],
              gap: theme.space[2],
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'baseline',
                flexWrap: 'wrap',
                gap: theme.space[2],
              }}
            >
              <Text
                style={{
                  ...textStyle(theme, 'display'),
                  color: theme.color.discover.ink,
                  fontWeight: theme.fontWeight.display,
                  fontVariant: ['tabular-nums'],
                }}
              >
                {dong(data.unitPriceVndPerMinute)}
              </Text>
              <Text style={{ ...textStyle(theme, 'caption'), color: theme.color.discover.muted }}>
                {tt('hall.perMinute')}
              </Text>
            </View>
            <Text style={{ ...textStyle(theme, 'micro'), color: theme.color.discover.muted }}>
              {tt('hall.pricePerMinute')}
            </Text>
            <View style={{ height: 1, alignSelf: 'stretch', backgroundColor: theme.color.discover.line }} />
            <Text style={{ ...textStyle(theme, 'caption'), color: theme.color.discover.ink }}>
              {`${tt('detail.target')} · ${data.targetMinutes} ${tt('detail.minutes')}`}
            </Text>
          </View>

          {/* THE lime moment on this screen, in a row of its own. */}
          <View style={{ gap: theme.space[2] }}>
            <Row label={tt('hall.progress')} value={`${tt('hall.slots')} · ${data.remainingSlots}`} />
            <LimeTrack fraction={done} />
          </View>

          {section('detail.instructions', data.instructions)}
          {section('detail.privacy', data.privacyNotice)}
          {section('detail.payment', data.paymentRule)}
        </View>
      </ScrollView>

      {/* One primary action, and its refusal in its place. */}
      <View
        onLayout={(e) => setFooter(e.nativeEvent.layout.height)}
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: theme.color.discover.paper,
          borderTopWidth: 1,
          borderTopColor: theme.color.discover.line,
          paddingHorizontal: theme.space[4],
          paddingTop: theme.space[3],
          paddingBottom: bottomInset(theme.space[6]),
          gap: theme.space[2],
        }}
      >
        {refusal === null ? (
          <Button
            label={claim.isPending ? tt('detail.claiming') : tt('detail.claim')}
            disabled={claim.isPending}
            onPress={() => claim.mutate()}
          />
        ) : (
          <View accessibilityLiveRegion="polite">
            <Text style={{ ...textStyle(theme, 'body'), color: theme.color.discover.muted, textAlign: 'center' }}>
              {tt(refusal)}
            </Text>
          </View>
        )}
        {alreadyClaimed ? (
          <Button label={tt('session.title')} onPress={() => nav.push({ name: 'sessionCreate' })} />
        ) : null}
      </View>
    </View>
  );
}

/** How far the hero travels against the scroll, and over how much of it. */
const PARALLAX_RANGE = 240;
const PARALLAX_RATE = 0.4;
