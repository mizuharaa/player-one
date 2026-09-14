import { useState } from 'react';
import { Text, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Chip, Field } from '../ui.tsx';
import {
  EmptyState,
  ImageLabel,
  LoadFailed,
  ScreenTitle,
  Skeleton,
  StaleStrip,
  TaskCard,
  WarmList,
  textStyle,
} from '../v2.tsx';

/**
 * SPEC §11. Browsing the work: image-first, two columns, the price legible on
 * every tile at every width.
 *
 * **This screen has no lime at all, and that is correct.** §0.2 spends lime at
 * most once per screen, on progress, and four tiles each with a lime track is
 * four accents. So the claim track here is `discover.soft` with a
 * `discover.muted` fill (drawn inside `TaskCard`) and the slot count beside it
 * carries the meaning — one per screen is a ceiling, not a quota.
 *
 * Every tile is `flex: 1` inside a two-column wrapper and never a computed
 * pixel width, which is what makes the grid survive 320dp and 412dp from one
 * layout. `claimable`, `claimedByMe`, `remainingSlots`, `claimedMinutes` /
 * `targetMinutes` and `unitPriceVndPerMinute` are rendered exactly as the
 * server sent them; the app orders nothing and filters only on the words the
 * collector typed.
 */
export function TaskHall() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });
  const listTarget = useGuideTarget('hall.list');
  const [search, setSearch] = useState('');
  const [availableOnly, setAvailableOnly] = useState(false);

  const needle = search.trim().toLocaleLowerCase();
  const visible = (tasks.data ?? []).filter((task) => {
    const scenario = task.scenario === null ? task.type : tt(`scenario.${task.scenario}`);
    return (
      (!availableOnly || task.claimable) &&
      `${task.title} ${scenario ?? ''}`.toLocaleLowerCase().includes(needle)
    );
  });

  const stateOf = (claimable: boolean, claimedByMe: boolean, full: boolean): string =>
    claimedByMe
      ? tt('detail.claimed')
      : claimable
        ? tt('hall.open')
        : full
          ? tt('hall.full')
          : tt('detail.unavailable');

  return (
    <WarmList
      data={visible}
      numColumns={2}
      keyOf={(task) => task.id}
      refresh={{ refreshing: tasks.isFetching && !tasks.isPending, onRefresh: () => void tasks.refetch() }}
      header={
        <View ref={listTarget} collapsable={false} style={{ gap: theme.space[3] }}>
          <ScreenTitle compact>{tt('hall.title')}</ScreenTitle>
          <Field label={tt('hall.search')} value={search} onChangeText={setSearch} />
          {/* Colour AND weight, never colour alone: `Chip`'s selected state is
              already a fill plus a weight change, which is §18's rule. */}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
            <Chip label={tt('hall.all')} selected={!availableOnly} onPress={() => setAvailableOnly(false)} />
            <Chip
              label={tt('hall.availableOnly')}
              selected={availableOnly}
              onPress={() => setAvailableOnly(true)}
            />
          </View>
          <ImageLabel />
          {/* §17: a failed refresh must not blank a screen that already had
              data on it — the strip sits above content that is KEPT. */}
          {tasks.isError && tasks.data !== undefined ? (
            <StaleStrip text={tt('common.refreshFailed')} />
          ) : null}
          {tasks.isPending ? (
            <View style={{ flexDirection: 'row', gap: theme.space[3] }}>
              <View style={{ flex: 1 }}>
                <Skeleton ratio={3 / 5} radius={theme.radius.xl} />
              </View>
              <View style={{ flex: 1 }}>
                <Skeleton ratio={3 / 5} radius={theme.radius.xl} />
              </View>
            </View>
          ) : null}
        </View>
      }
      empty={
        tasks.isPending ? null : tasks.isError && tasks.data === undefined ? (
          <LoadFailed onRetry={() => void tasks.refetch()} />
        ) : (
          <EmptyState text={tt(needle !== '' || availableOnly ? 'hall.noMatches' : 'home.claimableEmpty')} />
        )
      }
      renderItem={(task) => {
        const full = task.claimants >= task.maxClaimants;
        return (
          <View style={{ gap: theme.space[2] }}>
            <TaskCard
              task={task}
              variant="tile"
              hint={stateOf(task.claimable, task.claimedByMe, full)}
              onPress={() => nav.push({ name: 'taskDetail', taskId: task.id })}
            />
            {/* The state as a word under the tile rather than as a coloured
                pill on it: capacity is not a verdict, and the tile's own
                corners are already spoken for by the price and the scenario. */}
            <Text style={{ ...textStyle(theme, 'micro'), color: theme.color.discover.muted }}>
              {`${tt('hall.progress')} · ${task.claimedMinutes}/${task.targetMinutes} ${tt('detail.minutes')}`}
            </Text>
          </View>
        );
      }}
    />
  );
}
