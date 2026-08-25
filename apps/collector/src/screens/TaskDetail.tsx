import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav, useRoute } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Body, Button, Card, Note, Row, Screen, Title } from '../ui.tsx';
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
};

const claimErrorKey = (error: unknown): MessageKey =>
  CLAIM_ERRORS[error instanceof Error ? error.message : ''] ?? 'common.actionFailed';

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

  // A failed query used to fall into the same branch as a pending one, so a
  // dead network read "Đang tải…" for ever with no way out. Error and loading
  // are different screens, and the error one has a button.
  if (task.isError) {
    return (
      <Screen title={tt('detail.title')}>
        <Note text={tt('common.loadFailed')} />
        <Button label={tt('common.retry')} onPress={() => void task.refetch()} />
      </Screen>
    );
  }
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
      {/*
        The capacity and eligibility answers on screen came from a list that
        may be seconds old; the server's refusal is the authoritative one and
        it arrives here. Showing it — and locking the button while the claim is
        in flight — is what stops a collector tapping four times and being told
        nothing four times.
      */}
      {claim.isError ? <Note text={tt(claimErrorKey(claim.error))} /> : null}
      <Button
        label={claim.isPending ? tt('detail.claiming') : alreadyClaimed ? tt('detail.claimed') : tt('detail.claim')}
        disabled={!examPassed || full || alreadyClaimed || claim.isPending}
        onPress={() => claim.mutate()}
      />
    </Screen>
  );
}
