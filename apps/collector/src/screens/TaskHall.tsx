import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Body, Button, CardLink, Chip, Field, Hatch, ListScreen, Loading, Note, Progress, Row, Tag, Title } from '../ui.tsx';

/** APP-08: type, unit price, target, progress, claimable state. */
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
    return (!availableOnly || task.claimable) && `${task.title} ${scenario}`.toLocaleLowerCase().includes(needle);
  });

  return (
    <ListScreen
      title={tt('hall.title')}
      data={visible}
      keyOf={(task) => task.id}
      header={<View ref={listTarget} collapsable={false} style={{ gap: theme.space[3] }}>
        <Field label={tt('hall.search')} value={search} onChangeText={setSearch} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space[2] }}>
          <Chip label={tt('hall.all')} selected={!availableOnly} onPress={() => setAvailableOnly(false)} />
          <Chip label={tt('hall.availableOnly')} selected={availableOnly} onPress={() => setAvailableOnly(true)} />
        </View>
        {tasks.isError ? <><Note text={tt(tasks.data === undefined ? 'common.loadFailed' : 'common.refreshFailed')} /><Button label={tt('common.retry')} variant="secondary" disabled={tasks.isFetching} onPress={() => void tasks.refetch()} /></> : null}
        {tasks.isPending || tasks.isFetching ? <Loading /> : null}
      </View>}
      empty={
        tasks.isError || tasks.isPending ? null : <Hatch text={tt(needle || availableOnly ? 'hall.noMatches' : 'home.claimableEmpty')} />
      }
      renderItem={(task) => {
        const full = task.claimants >= task.maxClaimants;
        const state = task.claimedByMe ? tt('detail.claimed') : task.claimable ? tt('hall.open') : full ? tt('hall.full') : tt('detail.unavailable');
        const done =
          task.targetMinutes <= 0 ? 0 : Math.min(1, task.claimedMinutes / task.targetMinutes);
        return (
          <CardLink
            label={task.title}
            hint={state}
            onPress={() => nav.push({ name: 'taskDetail', taskId: task.id })}
          >
            {/* Identity first, and tighter than the facts under it: the
                card's subject is the task, not its unit price. The price used
                to be an `Amount` — 24sp bold, the loudest thing on the card and
                on every card below it — which put `TaskDetail`'s one allowed
                ink figure in a list, three times over. `DESIGN.md`: one hero
                per screen, and a figure that large earns it only beside its own
                sentence and its own action, which is what the detail screen
                gives it. Here it is a measured quantity in a column of them,
                right-aligned and tabular, which is how a collector compares two
                tasks. */}
            <View style={{ gap: theme.space[1] }}>
              <Title>{task.title}</Title>
              <Body muted>{task.scenario === null ? (task.type || tt('detail.notSupplied')) : tt(`scenario.${task.scenario}`)}</Body>
            </View>
            <View style={{ gap: theme.space[2], paddingTop: theme.space[1] }}>
              <Row label={tt('hall.pricePerMinute')} value={`${task.unitPriceVndPerMinute} ${task.currency}`} />
              {/* Progress is lime — `DESIGN.md`'s one job for `lime-600` — and
                  the bar with its own count is `Progress` now rather than a
                  hand-built band in this file, so the hall and the delivery
                  panel on Uploads draw the same shape from one place. */}
              <Progress
                label={tt('hall.progress')}
                value={`${task.claimedMinutes}/${task.targetMinutes} ${tt('detail.minutes')}`}
                fraction={done}
              />
              <Row label={tt('hall.slots')} value={`${task.claimants}/${task.maxClaimants}`} />
            </View>
            {/* Capacity is not a verdict. These two used to borrow the reject
                and pass hues, which put the colour that means "this episode was
                not paid for" on a task that is simply full. A task nobody can
                join is muted, the same way a disabled control is; a task that
                is open is the ink pill, which is where a collector's action is
                everywhere else in this app (`Chip`, `Button`). It was
                `tech[100]`, and tech is PaXini's mark now. */}
            {!task.claimable ? (
              <Tag
                label={state}
                fg={theme.color.mutedForeground}
                bg={theme.color.muted}
              />
            ) : (
              <Tag label={tt('hall.open')} fg={theme.color.actionInk} bg={theme.color.action} />
            )}
          </CardLink>
        );
      }}
    />
  );
}
