import { ScrollView, Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { mascotStateAt } from '@playerone/design/tokens';
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
 * first claimable task is an ink block with its unit price set large, its
 * target and its progress, and the sun action inside it; the rest are paper
 * cards under it; a task other collectors have filled is greyed and says so
 * (APP-10's cap, visible rather than discovered on the detail screen).
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
    <View style={{ flex: 1, backgroundColor: theme.color.surface }}>
      <View
        style={{
          backgroundColor: theme.color.background,
          borderBottomWidth: 1,
          borderBottomColor: theme.color.border,
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
                    backgroundColor: theme.color.stage.ground,
                    borderRadius: theme.radius.xl,
                    padding: theme.space[5],
                    gap: theme.space[3],
                  }}
                >
                  <View style={{ gap: theme.space[1] }}>
                    <Text
                      style={{
                        color: theme.color.stage.fg,
                        fontFamily: face(theme),
                        fontSize: theme.fontSize.md,
                        fontWeight: theme.fontWeight.semibold,
                      }}
                    >
                      {hero.title}
                    </Text>
                    {price(hero, theme.fontSize['3xl'], theme.color.stage.fg, theme.color.stage.mid)}
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
                        color: theme.color.stage.mid,
                        fontFamily: face(theme),
                        fontSize: theme.fontSize.sm,
                      }}
                    >
                      {tt('detail.target')} {hero.targetMinutes} {tt('detail.minutes')}
                    </Text>
                    {/* The bar never stands alone: the two counts it draws are
                        printed beside it, which is what stops it being a
                        decoration. Both are the server's. */}
                    <Text
                      style={{
                        color: theme.color.stage.fg,
                        fontFamily: theme.font.mono,
                        fontSize: theme.fontSize.sm,
                      }}
                    >
                      {hero.claimedMinutes}/{hero.targetMinutes}
                    </Text>
                  </View>
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
                        backgroundColor: theme.color.bamboo[500],
                      }}
                    />
                  </View>
                  <Button
                    label={tt('home.take')}
                    accessibilityHint={hero.title}
                    onPress={() => open(hero)}
                  />
                </View>
              )}

              {rest.map((task) => (
                <View
                  key={task.id}
                  style={{
                    backgroundColor: theme.color.card,
                    borderWidth: 1,
                    borderColor: theme.color.border,
                    borderRadius: theme.radius.xl,
                    padding: theme.space[5],
                    gap: theme.space[3],
                  }}
                >
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
                  <Button
                    label={tt('home.take')}
                    accessibilityHint={task.title}
                    onPress={() => open(task)}
                  />
                </View>
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
                    borderRadius: theme.radius.xl,
                    padding: theme.space[5],
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
                    bg={theme.color.background}
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
