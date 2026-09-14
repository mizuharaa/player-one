import { FlatList, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { mascotStateAt } from '@playerone/design/tokens';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useLocale, useT } from '../locale.tsx';
import { nextLocale, type MessageKey } from '../i18n.ts';
import { useTheme } from '../theme.tsx';
import { useGuide, useGuideTarget } from '../guide/Guide.tsx';
import { useSignOut } from '../session.tsx';
import { Button, Chip, Note, RingChip } from '../ui.tsx';
import {
  EmptyState,
  ImageBox,
  ImageLabel,
  LoadFailed,
  Rise,
  Skeleton,
  StaleStrip,
  TaskCard,
  WarmCard,
  WarmScreen,
  taskImage,
  textStyle,
  workImage,
} from '../v2.tsx';
import { dong } from '../money.ts';

/**
 * SPEC §10. The dashboard: a warm greeting, the money a human has already
 * approved, the one thing to do next, and the work that is open.
 *
 * Three rules from §0.2 and §0.8 decide almost everything on this screen, and
 * each of them is the kind a well-meaning rewrite breaks:
 *
 * 1. **The hero figure is `confirmedVnd`, and the total is demoted.** The
 *    honest answer to "how much have I earned" is the money a human has
 *    approved. A total that folds in an estimate, set at 42px, *is* an
 *    estimate presented as confirmed, which APP-34 forbids in so many words.
 *    The fuller number is one line beneath at `fontSize.sm`, labelled inline.
 *    `estimatedVnd` never appears as a bare figure anywhere on this screen.
 *
 * 2. **When the server sends no cycle there is no money here at all** — not a
 *    total, and not a confirmed/estimated split either, because a per-kind
 *    split is a per-kind subtotal and computing one on the client is the same
 *    forbidden arithmetic as the total. What remains is what the server
 *    actually sent: the counts, and the link into §14.
 *
 * 3. **The ring counts episodes, never money.** Two integers the app may
 *    divide, because a count is neither a currency nor a duration.
 *
 * Any `reduce`, `sum`, `+` or `parseFloat` over an amount or over effective
 * minutes is a rejected diff, in either state. The only arithmetic in this
 * file is over row counts.
 */
const REVIEWED = ['review_passed', 'review_failed'];

/** §10: the claimable row's cards are 78% of the viewport and snap. */
const CARD_FRACTION = 0.78;

export function Home() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const { locale, setLocale } = useLocale();
  const guide = useGuide();
  const signOut = useSignOut();
  const shift = mascotStateAt();

  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.boundDevices() });
  const episodes = useQuery({ queryKey: ['episodes'], queryFn: () => api.episodes() });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });
  const claims = useQuery({ queryKey: ['claims'], queryFn: () => api.myClaims() });
  const cycle = useQuery({ queryKey: ['income', 'cycle'], queryFn: () => api.incomeCycle() });

  const earningsTarget = useGuideTarget('home.earnings');
  const tasksTarget = useGuideTarget('home.tasks');
  const nextTarget = useGuideTarget('home.next');

  const all = episodes.data ?? [];
  const reviewed = all.filter((e) => REVIEWED.includes(e.state)).length;
  const pending = all.filter((e) => e.state === 'pending_upload').length;
  const waiting = all.filter((e) => e.state === 'under_review' || e.state === 'uploaded').length;
  const claimable = (tasks.data ?? []).filter((task) => task.claimable);
  const cardWidth = Math.round(width * CARD_FRACTION);

  /**
   * The one thing to do now, and the screen's only opinion.
   *
   * The order is §10's: claim, pair, upload, wait. Each arm names a sentence
   * and the destination that answers it; the last one has no action because
   * waiting on a reviewer is not something a collector can act on, and
   * offering a button that does nothing is the dead-button report restated.
   */
  const next: { copy: MessageKey; label?: MessageKey; go?: () => void } =
    (claims.data ?? []).length === 0
      ? { copy: 'home.nextClaim', label: 'hall.title', go: () => nav.push({ name: 'taskHall' }) }
      : (devices.data ?? []).length === 0
        ? { copy: 'home.nextPair', label: 'home.devices', go: () => nav.push({ name: 'devices' }) }
        : pending > 0
          ? { copy: 'home.nextUpload', label: 'home.uploads', go: () => nav.selectTab('uploads') }
          : waiting > 0
            ? { copy: 'home.nextReview' }
            : { copy: 'home.nextClaim', label: 'hall.title', go: () => nav.push({ name: 'taskHall' }) };

  /** The still beside the next step: the claimed task's, else work-portrait. */
  const claimedTask = (tasks.data ?? []).find((t) => t.claimedByMe);
  const nextImage =
    claimedTask === undefined ? workImage : taskImage(claimedTask.scenario, claimedTask.type);

  const caption = { ...textStyle(theme, 'caption'), color: theme.color.discover.muted };
  const sectionHeading = {
    ...textStyle(theme, 'section'),
    color: theme.color.discover.ink,
    fontWeight: theme.fontWeight.semibold,
  };

  return (
    <WarmScreen>
      {/* The greeting: plum, because §0.2 lets a tint repeat where an accent
          may not, and time-aware from the device clock — the one number this
          client may compute, since it is neither money nor minutes. */}
      <Rise index={0}>
        <View
          style={{
            backgroundColor: theme.color.discover.light,
            borderRadius: theme.radius.xl,
            padding: theme.space[5],
            gap: theme.space[1],
          }}
        >
          <Text style={{ ...textStyle(theme, 'section'), color: theme.color.discover.lightInk }}>
            {tt(`greeting.${shift}`)}
          </Text>
          <Text
            style={{
              ...textStyle(theme, 'display'),
              color: theme.color.discover.lightInk,
              fontWeight: theme.fontWeight.display,
            }}
          >
            {profile.data?.name ?? ''}
          </Text>
          <Text style={{ ...textStyle(theme, 'caption'), color: theme.color.discover.lightInk }}>
            {tt(`shift.${shift}`)}
          </Text>
        </View>
      </Rise>

      {/* The earnings card. §9 step 1 rings THIS view, not the figure inside
          it — a hole around the number alone hides the counts and the label
          that say where it came from. */}
      <Rise index={1}>
        <WarmCard innerRef={earningsTarget}>
          <Text style={caption}>{tt('home.cycleTitle')}</Text>
          {cycle.isPending ? (
            <Skeleton lines={3} />
          ) : (
            <Text
              style={{
                ...textStyle(theme, 'hero'),
                color: theme.color.discover.ink,
                fontWeight: theme.fontWeight.display,
                fontVariant: ['tabular-nums'],
              }}
            >
              {cycle.data === null || cycle.data === undefined
                ? NOTHING
                : dong(cycle.data.confirmedVnd)}
            </Text>
          )}
          {cycle.data === null || cycle.data === undefined ? (
            cycle.isPending ? null : (
              <Text style={caption}>{tt('home.cycleUnavailable')}</Text>
            )
          ) : (
            /* Labelled inline, never a bare estimate: "Đã xác nhận · Kể cả
               ước tính: 1.284.000 ₫". The two halves are two strings the
               server sent and one key that names the second one. */
            <Text style={caption}>
              {`${tt('income.confirmed')} · ${tt('home.cycleWithEstimate').replace(
                '{amount}',
                dong(cycle.data.totalVnd),
              )}`}
            </Text>
          )}

          <View
            style={{
              height: 1,
              alignSelf: 'stretch',
              backgroundColor: theme.color.discover.line,
              marginVertical: theme.space[1],
            }}
          />

          {/* Counts, and the screen's one lime. Never a money fraction. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[3], flexWrap: 'wrap' }}>
            <RingChip
              ring={{ filled: reviewed, total: all.length }}
              face={`${reviewed}/${all.length}`}
              label={tt('home.reviewedCaption')}
            />
            <Text style={[caption, { flexShrink: 1 }]}>
              {`${all.length} ${tt('home.uploadedCaption')}`}
            </Text>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={tt('home.incomeLink')}
            onPress={() => nav.selectTab('income')}
            style={({ pressed }) => ({
              minHeight: theme.space[12],
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space[3],
              opacity: pressed ? 0.7 : 1,
            })}
          >
            <Text style={{ ...textStyle(theme, 'body'), color: theme.color.discover.ink, flex: 1 }}>
              {tt('home.incomeLink')}
            </Text>
            <Text importantForAccessibility="no" style={{ ...textStyle(theme, 'section'), color: theme.color.discover.muted }}>
              ›
            </Text>
          </Pressable>
        </WarmCard>
      </Rise>

      {cycle.isError && cycle.data !== undefined ? <StaleStrip text={tt('common.refreshFailed')} /> : null}

      {/* The gates, above the next step, because a gate IS the next step when
          it applies. `Note` is §0.7's component for the sentence a machine
          says to a collector; it is not restyled here. */}
      {profile.data != null && !profile.data.examPassed ? <Note text={tt('home.gateExam')} /> : null}
      {devices.data?.length === 0 ? <Note text={tt('home.gateDevice')} /> : null}

      <Rise index={2}>
        <View ref={nextTarget} collapsable={false} style={{ gap: theme.space[2] }}>
          <Text style={sectionHeading}>{tt('home.nextTitle')}</Text>
          <View
            style={{
              backgroundColor: theme.color.discover.surface,
              borderRadius: theme.radius.xl,
              overflow: 'hidden',
            }}
          >
            <ImageBox source={nextImage} ratio={16 / 9}>
              <View style={{ position: 'absolute', top: theme.space[3], right: theme.space[3] }}>
                <ImageLabel floating />
              </View>
            </ImageBox>
            <View style={{ padding: theme.space[4], gap: theme.space[3] }}>
              <Text style={{ ...textStyle(theme, 'lead'), color: theme.color.discover.ink }}>
                {tt(next.copy).replace('{n}', String(pending))}
              </Text>
              {next.label === undefined || next.go === undefined ? null : (
                <Button label={tt(next.label)} onPress={next.go} />
              )}
            </View>
          </View>
        </View>
      </Rise>

      <Rise index={3}>
        <View ref={tasksTarget} collapsable={false} style={{ gap: theme.space[3] }}>
          <Text style={sectionHeading}>{tt('home.claimable')}</Text>
          <ImageLabel />
          {tasks.isError && tasks.data === undefined ? (
            <LoadFailed onRetry={() => void tasks.refetch()} />
          ) : tasks.isError ? (
            <StaleStrip text={tt('common.refreshFailed')} />
          ) : null}
          {tasks.isPending ? (
            <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
              <View style={{ width: cardWidth }}>
                <Skeleton ratio={4 / 3} radius={theme.radius.xl} />
              </View>
            </View>
          ) : null}
          {tasks.data !== undefined && claimable.length === 0 && !tasks.isError ? (
            <EmptyState
              text={tt('home.claimableEmpty')}
              actionLabel={tt('hall.title')}
              onAction={() => nav.push({ name: 'taskHall' })}
            />
          ) : null}
          {claimable.length > 0 ? (
            <FlatList
              horizontal
              showsHorizontalScrollIndicator={false}
              data={claimable}
              keyExtractor={(task) => task.id}
              snapToInterval={cardWidth + theme.space[3]}
              decelerationRate="fast"
              contentContainerStyle={{ gap: theme.space[3] }}
              renderItem={({ item }) => (
                // A viewport fraction, not a fixed pixel width: §0.4 bans the
                // second and this recomputes on every rotation and every
                // breakpoint.
                <View style={{ width: cardWidth }}>
                  <TaskCard
                    task={item}
                    variant="row"
                    hint={tt('detail.title')}
                    onPress={() => nav.push({ name: 'taskDetail', taskId: item.id })}
                  />
                </View>
              )}
            />
          ) : null}
        </View>
      </Rise>

      <Rise index={4}>
        <View style={{ gap: theme.space[3] }}>
          <Text style={caption}>{tt('home.more')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            <Chip label={tt('home.devices')} onPress={() => nav.push({ name: 'devices' })} />
            <Chip label={tt('home.myTasks')} onPress={() => nav.push({ name: 'myTasks' })} />
            <Chip label={tt('forum.title')} onPress={() => nav.selectTab('forum')} />
            <Chip label={tt('groups.title')} onPress={() => nav.push({ name: 'groupChats' })} />
            <Chip label={tt('home.training')} onPress={() => nav.push({ name: 'training' })} />
            <Chip label={tt('guide.open')} onPress={guide.accept} />
            <Chip label={tt('common.language')} onPress={() => setLocale(nextLocale(locale))} />
          </View>
          <Button label={tt('signIn.signOut')} variant="ghost" onPress={signOut} />
        </View>
      </Rise>

      {guide.offered ? (
        <WarmCard>
          <Text style={sectionHeading}>{tt('guide.offerTitle')}</Text>
          <Text style={{ ...textStyle(theme, 'body'), color: theme.color.discover.muted }}>
            {tt('guide.offerBody')}
          </Text>
          <Button label={tt('guide.offerYes')} variant="secondary" onPress={guide.accept} />
          <Button label={tt('guide.offerNo')} variant="ghost" onPress={guide.decline} />
        </WarmCard>
      ) : null}
    </WarmScreen>
  );
}

/**
 * What a figure the server did not send looks like. An em dash, never `0`:
 * the server having nothing to say is not the same as a zero, and on a money
 * screen the difference is the whole point.
 */
const NOTHING = '—';
