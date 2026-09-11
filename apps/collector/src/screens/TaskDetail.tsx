import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useApi } from '../api/context.tsx';
import { useNav, useRoute } from '../nav.tsx';
import { useT } from '../locale.tsx';
import { Body, Button, Card, FeatureBlock, Note, Row, Screen, Title } from '../ui.tsx';
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
  not_qualified: 'detail.notQualified',
  task_not_claimable: 'detail.unavailable',
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
  //
  // All three queries, not just the task: `profile` decides whether the exam
  // gate is shown and `claims` decides whether this task is already claimed,
  // so a failed read of either used to become a business answer — "you have
  // not passed the exam", "you have not claimed this" — when the truth was
  // "we do not know". Unknown state offers no action; it offers a retry.
  const failed = [task, profile, claims].find((q) => q.isError);
  if (failed !== undefined) {
    return (
      <Screen title={tt('detail.title')}>
        <Note text={tt('common.loadFailed')} />
        <Button
          label={tt('common.retry')}
          onPress={() => {
            void task.refetch();
            void profile.refetch();
            void claims.refetch();
          }}
        />
      </Screen>
    );
  }
  if (task.data === undefined || profile.data === undefined || claims.data === undefined) {
    return (
      <Screen title={tt('detail.title')}>
        <Body muted>{tt('common.loading')}</Body>
      </Screen>
    );
  }

  const examPassed = profile.data !== null && profile.data.examPassed;
  const alreadyClaimed = task.data.claimedByMe || claims.data.some((c) => c.taskId === taskId);
  const full = task.data.claimants >= task.data.maxClaimants;

  return (
    <Screen title={tt('detail.title')}>
      <Title>{task.data.title}</Title>

      {/*
        The screen's one ink block, and the only place in this app a figure is
        set large. It earns it: the unit price is what the whole task is worth
        to a collector, the sentence under it is the server's own payment rule,
        and the claim button directly below is the action it leads to. A figure
        without both of those would be the hero-metric template and does not go
        here.

        It is display only. The app never multiplies it by anything — money is
        computed once, on the server, and arrives per episode on Income.
      */}
      <FeatureBlock
        label={tt('hall.pricePerMinute')}
        value={`${task.data.unitPriceVndPerMinute} ${task.data.currency}`}
        sentence={task.data.paymentRule || tt('detail.notSupplied')}
      />

      <Card>
        <Row label={tt('session.scenario')} value={task.data.scenario === null ? tt('detail.notSupplied') : tt(`scenario.${task.data.scenario}`)} />
        <Row label={tt('detail.target')} value={`${task.data.targetMinutes} ${tt('detail.minutes')}`} />
        <Row label={tt('hall.slots')} value={`${task.data.claimants}/${task.data.maxClaimants}`} />
      </Card>
      <Card>
        <Title>{tt('detail.instructions')}</Title>
        <Body>{task.data.instructions || tt('detail.notSupplied')}</Body>
        <Title>{tt('detail.privacy')}</Title>
        <Body>{task.data.privacyNotice || tt('detail.notSupplied')}</Body>
      </Card>
      {!task.data.published ? <Note text={tt('detail.unavailable')} /> : null}
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
        disabled={!examPassed || !task.data.claimable || alreadyClaimed || claim.isPending}
        onPress={() => claim.mutate()}
      />
      {alreadyClaimed ? <Button label={tt('session.title')} onPress={() => nav.push({ name: 'sessionCreate' })} /> : null}
    </Screen>
  );
}
