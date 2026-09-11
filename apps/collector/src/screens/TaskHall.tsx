import { useState } from 'react';
import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Amount, Body, Button, CardLink, Chip, Field, Hatch, ListScreen, Note, Row, Tag, Title } from '../ui.tsx';

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
        {tasks.isPending || tasks.isFetching ? <Body muted>{tt('common.loading')}</Body> : null}
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
            <Title>{task.title}</Title>
            <Body muted>{task.scenario === null ? (task.type || tt('detail.notSupplied')) : tt(`scenario.${task.scenario}`)}</Body>
            <Amount label={tt('hall.pricePerMinute')} value={`${task.unitPriceVndPerMinute} ${task.currency}`} />
            <Row
              label={tt('hall.progress')}
              value={`${task.claimedMinutes}/${task.targetMinutes} ${tt('detail.minutes')}`}
            />
            {/* Progress is lime: "how far along this task is" and "this
                button does something" do not share a colour, and since
                2026-09-07 progress is lime rather than bamboo — bamboo is the
                stalk Trúc carries and nothing else. `lime[600]` is the stroke
                step, the same one `RingChip` fills its arc with; `lime[500]`
                is a fill for ink to sit on and reads 1.16:1 against the page,
                which is invisible in a 6dp bar. The two figures above it are
                what it means; the bar alone would be a decoration, and a bar
                alone is never how a state is read here. */}
            <View
              style={{
                height: theme.space[1.5],
                borderRadius: theme.space[1],
                backgroundColor: theme.color.muted,
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  width: `${done * 100}%`,
                  height: '100%',
                  backgroundColor: theme.color.lime[600],
                }}
              />
            </View>
            <Row label={tt('hall.slots')} value={`${task.claimants}/${task.maxClaimants}`} />
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
