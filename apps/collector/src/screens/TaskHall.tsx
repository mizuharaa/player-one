import { Pressable } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { useTheme } from '../theme.tsx';
import { Body, Card, Row, Screen, Tag, Title } from '../ui.tsx';

/** APP-08: type, unit price, target, progress, claimable state. */
export function TaskHall() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const theme = useTheme();
  const tasks = useQuery({ queryKey: ['tasks'], queryFn: () => api.tasks() });

  return (
    <Screen title={tt('hall.title')}>
      {tasks.data === undefined ? <Body muted>{tt('common.loading')}</Body> : null}
      {(tasks.data ?? []).map((task) => {
        const full = task.claimants >= task.maxClaimants;
        return (
          <Pressable key={task.id} onPress={() => nav.push({ name: 'taskDetail', taskId: task.id })}>
            <Card>
              <Title>{task.title}</Title>
              <Body muted>{tt(`scenario.${task.scenario}`)}</Body>
              <Row label={tt('hall.perMinute')} value={task.unitPriceVndPerMinute} />
              <Row
                label={tt('hall.progress')}
                value={`${task.claimedMinutes}/${task.targetMinutes} ${tt('detail.minutes')}`}
              />
              <Row label={tt('hall.slots')} value={`${task.claimants}/${task.maxClaimants}`} />
              {full ? (
                <Tag label={tt('hall.full')} fg={theme.color.verdict.reject.fg} bg={theme.color.verdict.reject.bg} />
              ) : (
                <Tag label={tt('hall.open')} fg={theme.color.verdict.pass.fg} bg={theme.color.verdict.pass.bg} />
              )}
            </Card>
          </Pressable>
        );
      })}
    </Screen>
  );
}
