import {ApiError} from '../lib/api.ts';

export interface ServiceStatus {id:string;state:'healthy'|'configured_unprobed'|'unconfigured'|'manual'|'available'|'unknown';detail:string}
export interface EngineeringStatus {checked_at:string;read_only:true;services:ServiceStatus[];security:{showcase_rls:boolean;runtime_bypass_rls:boolean}}
export interface EpisodeSummary {episode_id:string;last_seen_at:string|null;resolution_state:string|null;verification_state:string|null;upload_path:string|null;ingest_count:number}
export interface EpisodePage {episodes:EpisodeSummary[];next_cursor:string|null}
export interface EpisodeDetail {episode:EpisodeSummary;ingest:Record<string,unknown>|null;record_json:unknown;record_redacted:true;record_limit_bytes?:number}
export interface AuditEvent {id:string;occurred_at:string;action:string;target_table:string|null;target_id:string|null;actor_role:string|null}
export interface AuditPage {events:AuditEvent[];next_cursor:string|null;payloads_omitted:true}
export interface SampleProbe {probe:string;read_only:true;scope:string;checks:{id:string;passed:boolean}[]}
export const isEpisodeId=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function get<T>(path:string):Promise<T>{
  const response=await fetch(`/api/engineering${path}`,{credentials:'same-origin',headers:{Accept:'application/json'},signal:AbortSignal.timeout(20_000)});
  const body=await response.json().catch(()=>null) as Record<string,unknown>|null;
  if(!response.ok)throw new ApiError(response.status,typeof body?.error==='string'?body.error:response.statusText,body?.detail,typeof body?.constraint==='string'?body.constraint:undefined,body);
  if(body===null)throw new ApiError(502,'invalid_diagnostics_response');
  return body as T;
}
export const engineering={
  status:()=>get<EngineeringStatus>('/status'),
  episodes:(before:string|null)=>get<EpisodePage>(`/episodes?limit=25${before?`&before=${encodeURIComponent(before)}`:''}`),
  episode:(id:string)=>get<EpisodeDetail>(`/episodes/${encodeURIComponent(id)}`),
  audit:(episode:string|null,before:string|null)=>get<AuditPage>(`/audit?limit=50${episode?`&episode_id=${encodeURIComponent(episode)}`:''}${before?`&before=${encodeURIComponent(before)}`:''}`),
  sample:()=>get<SampleProbe>('/probes/sample-contract'),
};
