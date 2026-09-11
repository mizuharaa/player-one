import {useState,type ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {AppShell} from '../components/shell/AppShell.tsx';
import {useOperatorProfile} from '../lib/profile-api.ts';
import {ApiError} from '../lib/api.ts';
import {engineering,isEpisodeId,type ServiceStatus} from './api.ts';
import './engineering.css';

const states:Record<ServiceStatus['state'],string>={healthy:'engineeringHealthy',configured_unprobed:'engineeringConfigured',unconfigured:'engineeringUnconfigured',manual:'engineeringManual',available:'engineeringAvailable',unknown:'engineeringUnknown'};
const stamp=(value:string|null,locale:string)=>value&&Number.isFinite(Date.parse(value))?new Intl.DateTimeFormat(locale,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)):'—';

export function EngineeringScreen(){
  const {t,i18n}=useTranslation();const c=(key:string)=>t(`workspace.${key}`);
  const profile=useOperatorProfile();
  const allowed=profile.data?.operator.role==='administrator'&&profile.data.operator.status==='active';
  return <AppShell><div className="engineering-page"><header className="workspace-page-header"><div><h1>{c('engineering')}</h1><p>{c('engineeringNote')}</p></div><span className="engineering-readonly">{c('engineeringReadOnly')}</span></header>
    {profile.isPending?<p role="status">{c('loading')}</p>:profile.error?<Failure error={profile.error} retry={()=>void profile.refetch()} busy={profile.isFetching}/>:!allowed?<section className="engineering-notice"><h2>{c('engineeringRestricted')}</h2><p>{c('engineeringRestrictedBody')}</p></section>:<Diagnostics locale={i18n.language}/>}
  </div></AppShell>;
}

function Diagnostics({locale}:{locale:string}){
  const {t}=useTranslation();const c=(key:string)=>t(`workspace.${key}`);
  const [episodeCursor,setEpisodeCursor]=useState<string|null>(null);const [episodeHistory,setEpisodeHistory]=useState<(string|null)[]>([]);
  const [auditCursor,setAuditCursor]=useState<string|null>(null);const [auditHistory,setAuditHistory]=useState<(string|null)[]>([]);
  const [draft,setDraft]=useState('');const [selected,setSelected]=useState<string|null>(null);const [invalid,setInvalid]=useState(false);
  const status=useQuery({queryKey:['engineering','status'],queryFn:engineering.status,retry:false});
  const episodes=useQuery({queryKey:['engineering','episodes',episodeCursor],queryFn:()=>engineering.episodes(episodeCursor),retry:false});
  const detail=useQuery({queryKey:['engineering','episode',selected],queryFn:()=>engineering.episode(selected!),enabled:selected!==null,retry:false});
  const audit=useQuery({queryKey:['engineering','audit',selected,auditCursor],queryFn:()=>engineering.audit(selected,auditCursor),retry:false});
  const probe=useQuery({queryKey:['engineering','sample-contract'],queryFn:engineering.sample,enabled:false,retry:false});
  const select=(id:string|null)=>{setSelected(id);setDraft(id??'');setInvalid(false);setAuditCursor(null);setAuditHistory([]);};
  return <>
    <section className="engineering-section" data-guide="engineering.services"><SectionHeading title={c('engineeringServices')} note={c('engineeringServicesNote')}><Refresh busy={status.isFetching} onClick={()=>void status.refetch()}/></SectionHeading>
      {status.error?<Failure error={status.error} stale={Boolean(status.data)} retry={()=>void status.refetch()} busy={status.isFetching}/>:null}
      {status.isPending?<Loading/>:status.data?<><p className="engineering-meta">{c('engineeringChecked').replace('{{time}}',stamp(status.data.checked_at,locale))}</p><div className="engineering-services">{status.data.services.map(service=><article className="engineering-service" key={service.id}><div><code>{service.id}</code><span className="engineering-state" data-state={service.state}>{c(states[service.state]??'engineeringUnknown')}</span></div><p>{service.detail}</p></article>)}</div><details className="engineering-disclosure"><summary>{c('engineeringSecurity')}</summary><dl className="engineering-facts"><div><dt>{c('engineeringRls')}</dt><dd>{c(status.data.security.showcase_rls?'engineeringTrue':'engineeringFalse')}</dd></div><div><dt>{c('engineeringBypass')}</dt><dd>{c(status.data.security.runtime_bypass_rls?'engineeringTrue':'engineeringFalse')}</dd></div></dl></details></>:null}
      <div className="engineering-probe"><div><h3>{c('engineeringProbe')}</h3><p>{c('engineeringProbeNote')}</p></div><button className="workspace-button" type="button" disabled={probe.isFetching} onClick={()=>void probe.refetch()}>{c(probe.isFetching?'refreshing':'engineeringRunProbe')}</button></div>
      {probe.error?<Failure error={probe.error} stale={Boolean(probe.data)} retry={()=>void probe.refetch()} busy={probe.isFetching}/>:null}
      {probe.data?<div className="engineering-probe-result"><p>{probe.data.scope}</p><ul>{probe.data.checks.map(check=><li key={check.id}><code>{check.id}</code><strong>{c(check.passed?'engineeringProbePassed':'engineeringProbeFailed')}</strong></li>)}</ul></div>:null}
    </section>

    <section className="engineering-section" data-guide="engineering.episodes"><SectionHeading title={c('engineeringEpisodes')} note={c('engineeringEpisodesNote')}><Refresh busy={episodes.isFetching} onClick={()=>void episodes.refetch()}/></SectionHeading>
      <form className="engineering-lookup" onSubmit={event=>{event.preventDefault();const id=draft.trim();if(!isEpisodeId(id)){setInvalid(true);return;}select(id);}}><label htmlFor="engineering-episode-id">{c('engineeringEpisodeId')}<input id="engineering-episode-id" value={draft} onChange={event=>{setDraft(event.target.value);setInvalid(false);}} autoComplete="off" spellCheck={false} aria-invalid={invalid} aria-describedby={invalid?'engineering-id-error':undefined}/></label><button type="submit" className="workspace-button workspace-button-primary">{c('engineeringLookup')}</button>{selected?<button type="button" className="workspace-button" onClick={()=>select(null)}>{c('engineeringClear')}</button>:null}</form>
      {invalid?<p id="engineering-id-error" className="engineering-error" role="alert">{c('engineeringInvalid')}</p>:null}
      {episodes.error?<Failure error={episodes.error} stale={Boolean(episodes.data)} retry={()=>void episodes.refetch()} busy={episodes.isFetching}/>:null}
      {episodes.isPending?<Loading/>:episodes.data?<><Table label={c('engineeringEpisodes')}><thead><tr>{['engineeringEpisodeId','engineeringLastSeen','engineeringResolution','engineeringVerification','engineeringUploadPath','engineeringIngests'].map(key=><th key={key}>{c(key)}</th>)}</tr></thead><tbody>{episodes.data.episodes.map(episode=><tr key={episode.episode_id} data-selected={selected===episode.episode_id}><td><button type="button" className="engineering-id-link" onClick={()=>select(episode.episode_id)} aria-label={`${c('engineeringInspect')} ${episode.episode_id}`}>{episode.episode_id}</button></td><td>{stamp(episode.last_seen_at,locale)}</td><td>{episode.resolution_state??'—'}</td><td>{episode.verification_state??'—'}</td><td>{episode.upload_path??'—'}</td><td>{new Intl.NumberFormat(locale).format(episode.ingest_count)}</td></tr>)}</tbody></Table>{episodes.data.episodes.length===0?<p className="engineering-empty">{c('engineeringEmptyEpisodes')}</p>:null}<Pager previous={episodeHistory.length>0} next={Boolean(episodes.data.next_cursor)} busy={episodes.isFetching} onPrevious={()=>{setEpisodeCursor(episodeHistory.at(-1)??null);setEpisodeHistory(values=>values.slice(0,-1));}} onNext={()=>{setEpisodeHistory(values=>[...values,episodeCursor]);setEpisodeCursor(episodes.data!.next_cursor);}}/></>:null}
      <div className="engineering-inspector"><h3>{c('engineeringDetail')}</h3>{!selected?<p>{c('engineeringSelect')}</p>:detail.isPending?<Loading/>:detail.error?<Failure error={detail.error} retry={()=>void detail.refetch()} busy={detail.isFetching}/>:detail.data?<><p><code>{detail.data.episode.episode_id}</code><span className="engineering-readonly">{c('engineeringRedacted')}</span></p><p>{c('engineeringRecordNote')}</p><Json title={c('engineeringIngest')} value={detail.data.ingest}/>{detail.data.record_json!==null?<Json title={c('engineeringRecord')} value={detail.data.record_json}/>:<p>{c('engineeringNoRecord')}</p>}</>:null}</div>
    </section>

    <section className="engineering-section" data-guide="engineering.audit"><SectionHeading title={c('engineeringAudit')} note={`${c('engineeringAuditNote')} ${c(selected?'engineeringAuditSelected':'engineeringAuditAll')}`}><Refresh busy={audit.isFetching} onClick={()=>void audit.refetch()}/></SectionHeading>
      {audit.error?<Failure error={audit.error} stale={Boolean(audit.data)} retry={()=>void audit.refetch()} busy={audit.isFetching}/>:null}
      {audit.isPending?<Loading/>:audit.data?<><Table label={c('engineeringAudit')}><thead><tr>{['engineeringTime','engineeringAction','engineeringTarget','engineeringActor'].map(key=><th key={key}>{c(key)}</th>)}</tr></thead><tbody>{audit.data.events.map(event=><tr key={event.id}><td>{stamp(event.occurred_at,locale)}</td><td><code>{event.action}</code></td><td><span>{event.target_table??'—'}</span><code className="engineering-target-id">{event.target_id??'—'}</code></td><td>{event.actor_role??'—'}</td></tr>)}</tbody></Table>{audit.data.events.length===0?<p className="engineering-empty">{c('engineeringEmptyAudit')}</p>:null}<Pager previous={auditHistory.length>0} next={Boolean(audit.data.next_cursor)} busy={audit.isFetching} onPrevious={()=>{setAuditCursor(auditHistory.at(-1)??null);setAuditHistory(values=>values.slice(0,-1));}} onNext={()=>{setAuditHistory(values=>[...values,auditCursor]);setAuditCursor(audit.data!.next_cursor);}}/></>:null}
    </section>
  </>;
}

function SectionHeading({title,note,children}:{title:string;note:string;children?:ReactNode}){return <header className="engineering-heading"><div><h2>{title}</h2><p>{note}</p></div>{children}</header>;}
function Loading(){const {t}=useTranslation();return <p role="status" className="engineering-loading">{t('workspace.loading')}</p>;}
function Refresh({busy,onClick}:{busy:boolean;onClick:()=>void}){const {t}=useTranslation();return <button type="button" className="workspace-button" disabled={busy} onClick={onClick}>{t(busy?'workspace.refreshing':'workspace.refresh')}</button>;}
function Table({label,children}:{label:string;children:ReactNode}){return <div className="engineering-table-scroll" tabIndex={0} role="region" aria-label={label}><table>{children}</table></div>;}
function Json({title,value}:{title:string;value:unknown}){return <details className="engineering-disclosure"><summary>{title}</summary><pre tabIndex={0}><code>{JSON.stringify(value,null,2)}</code></pre></details>;}
function Pager({previous,next,busy,onPrevious,onNext}:{previous:boolean;next:boolean;busy:boolean;onPrevious:()=>void;onNext:()=>void}){const {t}=useTranslation();return <div className="engineering-pagination"><button className="workspace-button" type="button" disabled={!previous||busy} onClick={onPrevious}>{t('workspace.engineeringPrevious')}</button><button className="workspace-button" type="button" disabled={!next||busy} onClick={onNext}>{t('workspace.engineeringNext')}</button></div>;}
function Failure({error,stale=false,retry,busy}:{error:unknown;stale?:boolean;retry:()=>void;busy:boolean}){const {t}=useTranslation();const api=error instanceof ApiError?error:null;return <div className="engineering-error" role="alert"><p>{t(api?.status===403?'workspace.engineeringRestrictedBody':api?.status===404?'workspace.engineeringNotFound':stale?'workspace.refreshFailed':'workspace.loadFailedNote')}</p>{api?.ref?<p>{t('workspace.engineeringRequestRef')}: <code>{api.ref}</code></p>:null}<button type="button" className="workspace-button" disabled={busy} onClick={retry}>{t('workspace.retry')}</button></div>;}
