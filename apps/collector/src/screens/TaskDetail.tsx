import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav, useRoute } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Body, Button, Card, Note, Row, Screen, Title } from '../ui.tsx';

/**
 * APP-09 (instructions, scenario, privacy notice, payment rule) and APP-10
 * (claim, capacity-capped). The claim button states its gate instead of
 * failing silently: no exam pass, no claiming — mirrored server-side (APP-05).
 */
export function TaskDetail() {
  const api = useApi();
  const nav = useNav();
  const tt = useT();
  const { taskId } = useRoute('taskDetail');
  const queryClient = useQueryClient();

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

  if (task.data === undefined) {
    return (
      <Screen title={tt('detail.title')}>
        <Body muted>{tt('common.loading')}</Body>
      </Screen>
    );
  }

  const examPassed = profile.data?.examPassed === true;
  const alreadyClaimed = (claims.data ?? []).some((c) => c.taskId === taskId);
  const full = task.data.claimants >= task.data.maxClaimants;

  return (
    <Screen title={tt('detail.title')}>
      <Card>
        <Title>{task.data.title}</Title>
        <Row label={tt('session.scenario')} value={tt(`scenario.${task.data.scenario}`)} />
        <Row label={tt('hall.perMinute')} value={task.data.unitPriceVndPerMinute} />
        <Row label={tt('detail.target')} value={`${task.data.targetMinutes} ${tt('detail.minutes')}`} />
        <Row label={tt('hall.slots')} value={`${task.data.claimants}/${task.data.maxClaimants}`} />
      </Card>
      <Card>
        <Title>{tt('detail.instructions')}</Title>
        <Body>{task.data.instructions}</Body>
      </Card>
      <Card>
        <Title>{tt('detail.privacy')}</Title>
        <Body>{task.data.privacyNotice}</Body>
      </Card>
      <Card>
        <Title>{tt('detail.payment')}</Title>
        <Body>{task.data.paymentRule}</Body>
      </Card>
      {!examPassed ? <Note text={tt('detail.needExam')} /> : null}
      {full && !alreadyClaimed ? <Note text={tt('detail.full')} /> : null}
      <Button
        label={alreadyClaimed ? tt('detail.claimed') : tt('detail.claim')}
        disabled={!examPassed || full || alreadyClaimed}
        onPress={() => claim.mutate()}
      />
    </Screen>
  );
}
