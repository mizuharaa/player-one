import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { originality, type OriginalityDecision } from '../lib/api.ts';
import { Button } from '../components/ui/button.tsx';
import { LoadFailed, Section } from './pieces.tsx';
import { canReadFinance, useFinanceRole } from './role.ts';
import { keys } from './period.ts';
import { ORIGINALITY_COPY } from './originality-copy.ts';

export function OriginalityReview({ ingestId, billId, period }: { ingestId: string; billId: string; period: string }) {
  const { i18n } = useTranslation(), { role } = useFinanceRole(), client = useQueryClient();
  const copy = ORIGINALITY_COPY[i18n.language.startsWith('vi') ? 'vi' : i18n.language.startsWith('zh') ? 'zh' : 'en'];
  const key = ['originality', ingestId];
  const state = useQuery({ queryKey: key, queryFn: () => originality.ingest(ingestId), enabled: canReadFinance(role) });
  const latest = state.data?.assessments[0];
  const [reason, setReason] = useState(''), [decision, setDecision] = useState<OriginalityDecision | ''>('');
  const [decisionAssessment, setDecisionAssessment] = useState('');
  const limitation = role === 'administrator' && ['failed', 'unavailable'].includes(latest?.status ?? '') &&
    latest?.evidence.media_verified === true && ['insufficient_samples', 'low_information', 'budget_exceeded'].includes(latest.evidence.reason ?? '');
  const permanentReuse = state.data?.assessments.some((a) => a.decision === 'reused') === true;
  const confirmReuse = latest?.status === 'complete' || (role === 'administrator' && latest?.evidence.media_verified === true &&
    (latest.evidence.matching_ingests?.length ?? 0) > 0);
  const allowed = state.data?.identity_verified === true && latest !== undefined && decisionAssessment === latest.id && !latest.decision && !permanentReuse &&
    (decision === 'accepted_unassessable' ? limitation : decision === 'reused' ? confirmReuse : latest.status === 'complete');
  const save = useMutation({
    mutationFn: () => originality.decide(decisionAssessment, decision as OriginalityDecision, reason.trim()),
    onSuccess: async () => {
      setReason(''); setDecision('');
      client.setQueryData(keys.preflight(period), null);
      await Promise.all([key, keys.bill(billId), keys.batch(period), keys.preflight(period)].map(queryKey => client.invalidateQueries({ queryKey })));
    },
  });

  return <Section title={copy.title}>
    <p className="mb-2 break-all text-xs">{ingestId}</p>
    {state.data?.identity_verified === false ? <p role="status">{copy.identity}</p> : null}
    {state.isPending ? <p role="status">{copy.loading}</p> : state.error ? <LoadFailed error={state.error} /> : <>
      {!latest ? <p>{copy.pending}</p> : <>
        <p className="break-all text-sm">{copy.assessment}: {latest.id}</p>
        <p className="my-2 text-sm">{copy.code}: {latest.evidence.reason ?? latest.status}</p>
        {latest.decision ? <p role="status">{copy.prior}: {copy[latest.decision]} — {latest.reason}</p> : <p>{copy.review}</p>}
        <details className="my-3"><summary>{copy.matches}</summary>
          {latest.evidence.matching_ingests?.length ? <ul className="space-y-2">
            {latest.evidence.matching_ingests.map((match, index) => <li className="break-all text-sm" key={`${match.ingest_id}:${index}`}>
              {match.ingest_id} · {match.method}
              {match.segments?.map((s, n) => <p key={n}>{s.qStart}–{s.qEnd} ↔ {s.cStart}–{s.cEnd} {copy.samples}
                {s.scale !== undefined ? ` · ${copy.scale}: ${s.scale.toFixed(2)}` : ''}
                {s.reversed ? ` · ${copy.reversed}` : ''}{s.mirrored ? ` · ${copy.mirrored}` : ''}</p>)}
            </li>)}
          </ul> : <p>{copy.none}</p>}
        </details>
        {!latest.decision && !permanentReuse && (latest.status === 'complete' || limitation || confirmReuse) ? <form className="space-y-3" onSubmit={e => {
          e.preventDefault(); if (allowed && decision && reason.trim().length >= 10) save.mutate();
        }}>
          {limitation ? <p className="text-sm">{copy.limitation}</p> : null}
          <label className="block">{copy.choose}<select className="mt-1 block w-full border p-2" value={decisionAssessment === latest.id ? decision : ''} onChange={e => { setDecisionAssessment(latest.id); setDecision(e.target.value as OriginalityDecision | ''); }}>
            <option value="">{copy.choose}</option>
            {latest.status === 'complete' ? <option value="cleared">{copy.cleared}</option> : null}
            {confirmReuse ? <option value="reused">{copy.reused}</option> : null}
            {limitation ? <option value="accepted_unassessable">{copy.accepted_unassessable}</option> : null}
          </select></label>
          <label className="block">{copy.reason}<textarea className="mt-1 block w-full border p-2" required minLength={10} maxLength={4000} value={reason} onChange={e => setReason(e.target.value)} /></label>
          <Button type="submit" disabled={!decision || !allowed || reason.trim().length < 10 || save.isPending}>{copy.save}</Button>
        </form> : !latest.decision ? <p>{copy.pending}</p> : null}
      </>}
    </>}
    {save.error ? <LoadFailed error={save.error} /> : null}
    {save.isSuccess ? <p role="status">{copy.saved}</p> : null}
    <Button type="button" variant="outline" className="mt-3" onClick={() => { setDecision(''); setReason(''); void state.refetch(); }} disabled={state.isFetching}>{copy.refresh}</Button>
  </Section>;
}
