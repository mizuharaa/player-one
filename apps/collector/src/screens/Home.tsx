import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { mascotStateAt } from '@playerone/design/tokens';
import poster from '../../assets/landing-poster.jpg';
import type { Task } from '../api/types.ts';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useLocale, useT } from '../locale.tsx';
import { nextLocale } from '../i18n.ts';
import { useTheme } from '../theme.tsx';
import type { MessageKey } from '../i18n.ts';
import { Panda } from '../identity/Panda.tsx';
import { useGuide, useGuideTarget } from '../guide/Guide.tsx';
import {
  Body,
  Button,
  Card,
  Chip,
  Frost,
  Hatch,
  Note,
  RingChip,
  Tag,
  Title,
  face,
  tabBarHeight,
  topInset,
} from '../ui.tsx';
import { Rule } from '../glyphs.tsx';

/**
 * The dashboard, and it is task-first.
 *
 * A collector opens this app to find work. So the task hall is the hero: the
 * first claimable task is a full-width photograph with its unit price set
 * large over it, its target and its progress on the same image, and the
 * primary action — an ink pill now, not sun — directly under it; the rest are
 * glass cards below; a task other collectors have filled is greyed and says so
 * (APP-10's cap, visible rather than discovered on the detail screen).
 *
 * **The hero is a picture.** It was an ink block with a big number in it,
 * which is the hero-metric template the craft floor names, and the world
 * committed on 2026-09-07 puts a large image at the centre of the screen
 * instead. Nothing about what the block *said* moved: the same title, the same
 * printed unit price, the same two counts, the same one action.
 *
 * ponytail: the still is `assets/landing-poster.jpg`, the poster frame of the
 * landing film — a collector wearing the Ego in a kitchen, which is this
 * product's own scene and not a stock illustration. It is the only photograph
 * in the repository and it is therefore the same picture whichever task is
 * first, while `Task.scenario` already distinguishes `home` / `office` /
 * `warehouse`. When per-scenario stills exist, key the source off that field:
 * one map from scenario to asset, one line at the `source` prop, nothing else
 * on this screen changes.
 *
 * **What the header carries.** The greeting, the language chip, and the
 * episode ring shrunk to a chip: `reviewed of returned`, drawn as a small
 * bamboo arc with its count and caption beside it. Counts are "episodes the
 * API returned", never an inventory of what is still on the camera — so while
 * `api.episodes()` is loading or has failed the chip says which, and never
 * draws a measured zero. The full six APP-23 states live on Uploads, one per
 * episode row, which is where APP-24 puts them anyway. Trúc peeks in from the
 * top-right corner; tapping him reacts and does nothing else.
 *
 * **Every figure is the server's string.** The unit price is printed, never
 * multiplied; there are no minutes summed and no money on this screen at all
 * (APP-33/34 keep both per-episode on Income).
 *
 * **Nothing here starts an upload.** APP-25 puts that behind one explicit
 * confirmation on Uploads and nowhere else. The claim buttons open the task's
 * own detail screen, where the exam, agreement and capacity gates are stated
 * and the claim actually happens.
 */

const REVIEWED = ['review_passed', 'review_failed'];

export function Home() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const { locale, setLocale } = useLocale();
  const guide = useGuide();
  const shift = mascotStateAt();

  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.profile() });
  const devices = useQuery({ queryKey: ['devices'], queryFn: () => api.boundDevices() });
  const episodes = useQuery({ queryKey: ['episodes'], queryFn: () => api.episodes() });
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });

  const ringTarget = useGuideTarget('home.ring');
  const tasksTarget = useGuideTarget('home.tasks');

  const rows = episodes.data ?? [];
  const reviewed = rows.filter((e) => REVIEWED.includes(e.state)).length;
  /** Loading and failure are their own answers here, not a count of zero. */
  const ring = episodes.data === undefined ? undefined : { filled: reviewed, total: rows.length };
  const ringLabel = episodes.isError
    ? tt('home.ringFailed')
    : episodes.data === undefined
      ? tt('home.ringLoading')
      : `${reviewed} ${tt('home.reviewedCaption')}`;

  const all = tasks.data ?? [];
  const claimable = all.filter((t) => t.claimants < t.maxClaimants);
  const full = all.filter((t) => t.claimants >= t.maxClaimants);
  const hero = claimable[0];
  const rest = claimable.slice(1);

  const open = (task: Task) => nav.push({ name: 'taskDetail', taskId: task.id });

  /**
   * The price, as the server sent it, with its unit under it.
   *
   * Under and not beside: Vietnamese spells the unit "đ/phút hiệu quả" and set
   * inline beside a 33dp figure it wrapped, leaving "quả" alone on a line of
   * its own. Stacked, the figure keeps its size in every catalogue and the
   * unit — which is the load-bearing half, because payment is per *effective*
   * minute — stays whole.
   */
  const price = (task: Task, size: number, ink: string, unitInk: string) => (
    <View>
      <Text
        style={{
          color: ink,
          fontFamily: theme.font.mono,
          fontSize: size,
          fontWeight: theme.fontWeight.bold,
          letterSpacing: -0.5,
        }}
      >
        {task.unitPriceVndPerMinute}
      </Text>
      <Text style={{ color: unitInk, fontFamily: face(theme), fontSize: theme.fontSize.sm }}>
        {tt('hall.perMinute')}
      </Text>
    </View>
  );

  return (
    // One continuous lavender wash: the page and its header are the same
    // ground, with no rule between them, because the surfaces above are glass
    // and glass needs one field behind it rather than two bands.
    <View style={{ flex: 1, backgroundColor: theme.color.background }}>
      <View
        style={{
          backgroundColor: theme.color.background,
          paddingTop: topInset(theme.space[6]) + theme.space[2],
          paddingHorizontal: theme.space[4],
          paddingBottom: theme.space[3],
          gap: theme.space[3],
          // Trúc leans in from beyond the right edge and is cut by it, which is
          // what makes him a peek rather than a fifth element in the row.
          overflow: 'hidden',
        }}
      >
        <View style={{ position: 'absolute', right: -theme.space[5], top: 0 }}>
          <Panda size={theme.space[20]} onPress={() => {}} label={tt('landing.pandaLabel')} />
        </View>
        <View style={{ paddingRight: theme.space[16], gap: theme.space[0.5] }}>
          <Text
            accessibilityRole="header"
            style={{
              color: theme.color.foreground,
              fontFamily: face(theme),
              fontSize: theme.fontSize.xl,
              fontWeight: theme.fontWeight.bold,
              letterSpacing: -0.5,
            }}
          >
            {tt(`greeting.${shift}` as MessageKey)}
          </Text>
          {profile.data?.name === undefined ? null : (
            <Text
              numberOfLines={1}
              style={{
                color: theme.color.mutedForeground,
                fontFamily: face(theme),
                fontSize: theme.fontSize.sm,
              }}
            >
              {profile.data.name} · {tt(`shift.${shift}` as MessageKey)}
            </Text>
          )}
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space[2] }}>
          <Chip
            label={tt('common.language')}
            accessibilityLabel={tt('common.language')}
            onPress={() => setLocale(nextLocale(locale))}
          />
          {/* APP-24: the count is a way into the full list, never a dead end. */}
          <View ref={ringTarget} collapsable={false}>
            <RingChip ring={ring} label={ringLabel} onPress={() => nav.selectTab('uploads')} />
          </View>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: theme.space[4],
          paddingBottom: theme.space[4] + tabBarHeight(theme),
          gap: theme.space[3],
        }}
      >
        {/* The two gates that shape a collector's day, stated rather than
            discovered. They are Notes, so TalkBack reads them when they
            appear, and they stay above the work they block. */}
        {profile.data !== undefined && profile.data !== null && !profile.data.examPassed ? (
          <Note text={tt('home.gateExam')} />
        ) : null}
        {devices.data !== undefined && devices.data.length === 0 ? (
          <Note text={tt('home.gateDevice')} />
        ) : null}

        <View ref={tasksTarget} collapsable={false} style={{ gap: theme.space[3] }}>
          <Title>{tt('home.claimable')}</Title>
          {tasks.isError ? (
            <Note text={tt('common.loadFailed')} />
          ) : tasks.data === undefined ? (
            <Body muted>{tt('common.loading')}</Body>
          ) : claimable.length === 0 && full.length === 0 ? (
            <Hatch text={tt('home.claimableEmpty')} />
          ) : (
            <>
              {hero === undefined ? (
                <Hatch text={tt('home.claimableEmpty')} />
              ) : (
                <View
                  style={{
                    borderRadius: theme.radius.xl,
                    borderWidth: 1,
                    borderColor: theme.color.border,
                    overflow: 'hidden',
                  }}
                >
                  {/*
                    192dp of picture. Measured on the short end of the Android
                    range this pilot ships to: at 390×640 a 240dp image pushed
                    the claim button under the floating bar at rest, so the one
                    action the screen exists for needed a scroll to reach on the
                    device class least able to afford one. At 192 it clears by
                    26dp there and the photograph still leads the screen at 844.
                  */}
                  <View style={{ height: theme.space[16] * 3, justifyContent: 'flex-end' }}>
                    {/* The picture. `cover` and not `contain`: this is the
                        card's ground, and a letterboxed still with bars down
                        the sides is a screenshot of a photograph rather than a
                        photograph. It carries no accessible name — every fact
                        on this card is in the text laid over it. */}
                    <Image
                      source={poster}
                      resizeMode="cover"
                      style={StyleSheet.absoluteFill}
                    />
                    {/*
                      One flat ink field over the film, at the same 0.62 the
                      landing screen measured its own scrim at, and for the
                      same reason: the worst pixel a photograph can hold is
                      white, `stage.ground` at 0.62 over white composites to
                      #6B6C6E, and `stage.over` on that is 5.26:1. Flat, not a
                      gradient — the token contract has never allowed one on an
                      ink, and a fade would leave the top of the figure sitting
                      on an unmeasured part of the picture.
                    */}
                    <View
                      pointerEvents="none"
                      style={[
                        StyleSheet.absoluteFill,
                        { backgroundColor: theme.color.stage.ground, opacity: 0.62 },
                      ]}
                    />
                    <View style={{ padding: theme.space[5], gap: theme.space[3] }}>
                      <View style={{ gap: theme.space[1] }}>
                        <Text
                          style={{
                            color: theme.color.stage.over,
                            fontFamily: face(theme),
                            fontSize: theme.fontSize.md,
                            fontWeight: theme.fontWeight.semibold,
                          }}
                        >
                          {hero.title}
                        </Text>
                        {price(
                          hero,
                          theme.fontSize['3xl'],
                          theme.color.stage.over,
                          theme.color.stage.over,
                        )}
                      </View>
                      <View
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'baseline',
                          gap: theme.space[3],
                        }}
                      >
                        <Text
                          style={{
                            color: theme.color.stage.over,
                            fontFamily: face(theme),
                            fontSize: theme.fontSize.sm,
                          }}
                        >
                          {tt('detail.target')} {hero.targetMinutes} {tt('detail.minutes')}
                        </Text>
                        {/* The bar never stands alone: the two counts it draws
                            are printed beside it, which is what stops it being
                            a decoration. Both are the server's. */}
                        <Text
                          style={{
                            color: theme.color.stage.over,
                            fontFamily: theme.font.mono,
                            fontSize: theme.fontSize.sm,
                          }}
                        >
                          {hero.claimedMinutes}/{hero.targetMinutes}
                        </Text>
                      </View>
                      {/*
                        Progress is lime now — bamboo is Trúc's own stalk and
                        nothing else. The bar lives on the scrim rather than on
                        the glass below it because `lime[500]` is a fill under
                        ink and measures 1.08:1 against the light scheme's
                        muted track, which is a bar nobody can see; on the
                        scrim it is 3.90:1 at the worst pixel and 13.94:1 at
                        the darkest.
                      */}
                      <View
                        style={{
                          height: theme.space[1.5],
                          borderRadius: theme.space[1],
                          backgroundColor: theme.color.stage.line,
                          overflow: 'hidden',
                        }}
                      >
                        <View
                          style={{
                            width: `${
                              hero.targetMinutes <= 0
                                ? 0
                                : Math.min(100, (hero.claimedMinutes / hero.targetMinutes) * 100)
                            }%`,
                            height: '100%',
                            backgroundColor: theme.color.lime[500],
                          }}
                        />
                      </View>
                    </View>
                  </View>
                  {/* The action sits on glass under the picture, not on it: the
                      primary is an ink pill and an ink pill on an ink scrim is
                      a pill nobody can find. */}
                  <View style={{ padding: theme.space[4] }}>
                    <Frost fill={theme.glass.card.fill} />
                    <Button
                      label={tt('home.take')}
                      accessibilityHint={hero.title}
                      onPress={() => open(hero)}
                    />
                  </View>
                </View>
              )}

              {rest.map((task) => (
                <Card key={task.id}>
                  <View style={{ gap: theme.space[1] }}>
                    <Text
                      style={{
                        color: theme.color.foreground,
                        fontFamily: face(theme),
                        fontSize: theme.fontSize.md,
                        fontWeight: theme.fontWeight.semibold,
                      }}
                    >
                      {task.title}
                    </Text>
                    {price(task, theme.fontSize['2xl'], theme.color.foreground, theme.color.mutedForeground)}
                  </View>
                  {/* Secondary, not primary: one screen, one primary. Three
                      identical ink pills down a page is three things all
                      claiming to be the thing the screen is for, and the hero
                      is the one that is. Same action, same target size. */}
                  <Button
                    label={tt('home.take')}
                    variant="secondary"
                    accessibilityHint={task.title}
                    onPress={() => open(task)}
                  />
                </Card>
              ))}

              {/* APP-10's cap, on the shelf rather than hidden: a task other
                  collectors have filled stays visible, greyed, with the reason
                  in words and no control on it. */}
              {full.map((task) => (
                <View
                  key={task.id}
                  accessible
                  accessibilityLabel={`${task.title}: ${tt('hall.full')}`}
                  style={{
                    backgroundColor: theme.color.muted,
                    borderWidth: 1,
                    borderColor: theme.color.border,
                    borderRadius: theme.radius.lg,
                    padding: theme.space[4],
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: theme.space[3],
                  }}
                >
                  <View style={{ flexGrow: 1, flexShrink: 1, gap: theme.space[1] }}>
                    <Text
                      style={{
                        color: theme.color.mutedForeground,
                        fontFamily: face(theme),
                        fontSize: theme.fontSize.md,
                        fontWeight: theme.fontWeight.semibold,
                      }}
                    >
                      {task.title}
                    </Text>
                    {price(
                      task,
                      theme.fontSize.lg,
                      theme.color.mutedForeground,
                      theme.color.faintForeground,
                    )}
                  </View>
                  <Tag
                    label={tt('hall.full')}
                    fg={theme.color.mutedForeground}
                    // `surface`, not `background`: the page is `background`
                    // now and a pill in the page colour on a muted card is
                    // 1.06:1 of fill against fill. Measured here: 6.95:1.
                    bg={theme.color.surface}
                  />
                </View>
              ))}
            </>
          )}
        </View>

        {/*
          The rest of the app, as chips rather than as a column of full-width
          buttons. Six identical outlined bars was the first version and it read
          as a link dump: same size, same weight, no order, and two of them
          repeating destinations the bottom bar already carries a tab for. These
          are the places with no tab of their own, they are secondary by their
          size, and the section says so.

          "Thu nhập" is here as a way in and carries no figure — money lives on
          Income, per episode, and the app sums nothing (APP-33/34).
        */}
        {/* The tour is offered under the work, not over it. On top it pushed
            the first task off the fold on the one run where a collector has
            never seen the screen — which is the run the task hall matters
            most. */}
        {guide.offered ? (
          <Card>
            <Title>{tt('guide.offerTitle')}</Title>
            <Body muted>{tt('guide.offerBody')}</Body>
            <View style={{ flexDirection: 'row', gap: theme.space[2] }}>
              <Button label={tt('guide.offerYes')} onPress={guide.accept} />
              <Button label={tt('guide.offerNo')} variant="ghost" onPress={guide.decline} />
            </View>
          </Card>
        ) : null}

        <Rule />
        <Title>{tt('home.more')}</Title>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          {/* The task hall lost its bar slot to the forum (`shell/TabBar.tsx`
              has the width measurement that forced the swap). It is one tap
              from here, and everything it lists is already on this screen
              above — the hall adds the progress bar and the claimant count. */}
          <Chip label={tt('hall.title')} onPress={() => nav.push({ name: 'taskHall' })} />
          <Chip label={tt('home.incomeLink')} onPress={() => nav.selectTab('income')} />
          <Chip label={tt('home.myTasks')} onPress={() => nav.push({ name: 'myTasks' })} />
          <Chip label={tt('home.devices')} onPress={() => nav.push({ name: 'devices' })} />
          <Chip label={tt('home.training')} onPress={() => nav.push({ name: 'training' })} />
          <Chip label={tt('guide.open')} onPress={guide.accept} />
        </View>
      </ScrollView>
    </View>
  );
}
