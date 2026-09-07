import { View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { useGuideTarget } from '../guide/Guide.tsx';
import { Body, CardLink, Hatch, ListScreen, Note, Row, Tag, Title } from '../ui.tsx';

/** APP-08: type, unit price, target, progress, claimable state. */
export function TaskHall() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });
  const listTarget = useGuideTarget('hall.list');

  return (
    <ListScreen
      title={tt('hall.title')}
      data={tasks.data ?? []}
      keyOf={(task) => task.id}
      header={<View ref={listTarget} collapsable={false} />}
      empty={
        tasks.isError ? (
          <Note text={tt('common.loadFailed')} />
        ) : tasks.data === undefined ? (
          <Body muted>{tt('common.loading')}</Body>
        ) : (
          <Hatch text={tt('home.claimableEmpty')} />
        )
      }
      renderItem={(task) => {
        const full = task.claimants >= task.maxClaimants;
        const done =
          task.targetMinutes <= 0 ? 0 : Math.min(1, task.claimedMinutes / task.targetMinutes);
        return (
          <CardLink
            label={task.title}
            hint={full ? tt('hall.full') : tt('hall.open')}
            onPress={() => nav.push({ name: 'taskDetail', taskId: task.id })}
          >
            <Title>{task.title}</Title>
            <Body muted>{tt(`scenario.${task.scenario}`)}</Body>
            <Row label={tt('hall.perMinute')} value={task.unitPriceVndPerMinute} />
            <Row
              label={tt('hall.progress')}
              value={`${task.claimedMinutes}/${task.targetMinutes} ${tt('detail.minutes')}`}
            />
            {/* Progress is bamboo and never sun: "how far along this task is"
                and "this button does something" stop sharing a colour. The two
                figures above it are what it means; the bar alone would be a
                decoration, and a bar alone is never how a state is read here. */}
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
                  backgroundColor: theme.color.bamboo[600],
                }}
              />
            </View>
            <Row label={tt('hall.slots')} value={`${task.claimants}/${task.maxClaimants}`} />
            {/* Capacity is not a verdict. These two used to borrow the reject
                and pass hues, which put the colour that means "this episode was
                not paid for" on a task that is simply full. Tech is what the
                platform reports; a task nobody can join is muted, the same way
                a disabled control is. */}
            {full ? (
              <Tag
                label={tt('hall.full')}
                fg={theme.color.mutedForeground}
                bg={theme.color.muted}
              />
            ) : (
              <Tag label={tt('hall.open')} fg={theme.color.techInk} bg={theme.color.tech[100]} />
            )}
          </CardLink>
        );
      }}
    />
  );
}
