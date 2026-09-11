import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { AppShell } from '../components/shell/AppShell.tsx';
import { useOperatorProfile } from '../lib/profile-api.ts';
import { ApiError } from '../lib/api.ts';
import { SHOWCASE_COPY } from './copy.ts';
import './showcase.css';

type Clip = { id: string; filename: string; bytes: number; expires_at: string;
  verdict: 'good' | 'partial' | 'bad' | null; note: string; reviewed_at: string | null };
const PATH = '/api/showcase/footage';
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: 'same-origin',
    signal: init?.signal ?? AbortSignal.timeout(30_000),
    headers: { ...(init?.body != null ? { 'Content-Type': 'application/json' } : {}), 'X-Showcase-Request': '1', ...init?.headers } });
  const body = response.status === 204 ? null : await response.json();
  if (!response.ok) throw new Error(body?.error ?? 'failed');
  return body as T;
}

export function ShowcaseScreen() {
  const { i18n } = useTranslation();
  const locale = i18n.language.startsWith('vi') ? 'vi' : i18n.language.startsWith('zh') ? 'zh' : 'en';
  const c = SHOWCASE_COPY[locale];
  const profile = useOperatorProfile();
  const permitted = !!profile.data?.operator && !profile.isError;
  const clips = useQuery({ queryKey: ['showcase', 'clips', profile.data?.operator.id],
    queryFn: () => request<{ clips: Clip[] }>(PATH), enabled: permitted, retry: false });
  const xhr = useRef<XMLHttpRequest | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  useEffect(() => () => { if (xhr.current) { xhr.current.onload = null; xhr.current.onerror = null;
    xhr.current.ontimeout = null; xhr.current.onabort = null; xhr.current.upload.onprogress = null; xhr.current.abort(); } }, []);
  const errorText = (message: string) => c[message as keyof typeof c] ?? c.failed;
  const clip = clips.data?.clips.find(item => item.id === selected) ?? clips.data?.clips[0];
  const upload = () => {
    if (xhr.current) return;
    if (!file || file.size <= 0 || file.size > 20 * 1024 * 1024 || !['video/mp4', 'video/webm'].includes(file.type)) {
      setError('fileError'); return;
    }
    setError(''); setProgress(0);
    const transfer = new XMLHttpRequest(); xhr.current = transfer;
    let finished = false;
    const done = () => {
      if (finished) return false;
      finished = true; xhr.current = null; setProgress(null); return true;
    };
    transfer.onload = () => {
      if (!done()) return;
      let response: { error?: string; clip?: Clip } = {};
      try { response = JSON.parse(transfer.responseText); } catch { /* Generic request error below. */ }
      if (transfer.status !== 201 || !response.clip) { setError(response.error ?? 'failed'); return; }
      setSelected(response.clip.id); setFile(null); if (fileInput.current) fileInput.current.value = '';
      void clips.refetch();
    };
    transfer.onerror = () => { if (done()) { setError('uploadUncertain'); void clips.refetch(); } };
    transfer.ontimeout = () => { if (done()) { setError('uploadTimeout'); void clips.refetch(); } };
    transfer.onabort = () => { if (done()) { setError('uploadCancelled'); void clips.refetch(); } };
    try {
    transfer.open('POST', `${PATH}?filename=${encodeURIComponent(file.name)}`);
    transfer.setRequestHeader('Content-Type', file.type);
    transfer.setRequestHeader('X-Showcase-Request', '1');
    transfer.timeout = 120_000;
    transfer.upload.onprogress = event => { if (!finished && event.lengthComputable) setProgress(Math.round(event.loaded / event.total * 100)); };
    transfer.send(file);
    } catch { done(); setError('failed'); }
  };

  return <AppShell><div className="workspace-page showcase-studio">
    <header className="workspace-page-header"><div><h1>{c.title}</h1><p>{c.intro}</p></div></header>
    <p className="showcase-boundary">{c.boundary}</p>
    {profile.isPending ? <p role="status">{c.loading}</p> : !permitted ? <div role="status">
      <p>{profile.error instanceof ApiError && [401, 403].includes(profile.error.status) ? c.denied : c.failed}</p>
      <button className="workspace-button" onClick={() => void profile.refetch()}>{c.retry}</button>
    </div> : <>
      <section className="showcase-upload" aria-label={c.choose}>
        <label htmlFor="showcase-file">{c.choose}</label>
        <input ref={fileInput} id="showcase-file" type="file" accept="video/mp4,video/webm" disabled={progress !== null}
          onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); }} />
        <p>{c.limits}</p>
        <div className="showcase-actions"><button className="workspace-button workspace-button-primary" disabled={!file || progress !== null} onClick={upload}>{c.upload}</button>
          {progress !== null && <><progress max="100" value={progress} aria-label={c.uploading} /><span role="status">{progress === 100 ? c.finalizing : `${c.uploading} ${progress}%`}</span><button className="workspace-button" onClick={() => xhr.current?.abort()}>{c.cancel}</button></>}
        </div>
        {error && <p role="alert">{errorText(error)}</p>}
      </section>
      <section className="showcase-library" aria-label={c.list}>
        <div><h2>{c.list}</h2><button className="workspace-button" disabled={clips.isFetching} onClick={() => void clips.refetch()}>{c.refresh}</button>{clips.isPending ? <p role="status">{c.loading}</p> : clips.isError ? <><p role="alert">{c.failed}</p><button className="workspace-button" onClick={() => void clips.refetch()}>{c.retry}</button></> : !clips.data?.clips.length ? <p>{c.empty}</p> :
          <ul>{clips.data.clips.map(item => <li key={item.id}><button className="showcase-clip" aria-pressed={clip?.id === item.id} onClick={() => setSelected(item.id)}>
            <strong>{item.filename}</strong><span>{(item.bytes / 1024 / 1024).toFixed(1)} MB · {item.verdict ? c.reviewed : c.unreviewed}</span>
          </button></li>)}</ul>}</div>
        {clip && <ClipReview key={clip.id} clip={clip} copy={c} locale={locale} onChange={() => void clips.refetch()} />}
      </section>
    </>}
  </div></AppShell>;
}

function ClipReview({ clip, copy: c, locale, onChange }: { clip: Clip; copy: typeof SHOWCASE_COPY.en; locale: string; onChange: () => void }) {
  const [verdict, setVerdict] = useState<NonNullable<Clip['verdict']>>(clip.verdict ?? 'good');
  const [note, setNote] = useState(clip.note);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [playbackError, setPlaybackError] = useState(false);
  const act = async (remove = false) => {
    setBusy(remove ? 'delete' : 'review'); setError(''); setSaved(false);
    try {
      await request(`${PATH}/${clip.id}${remove ? '' : '/review'}`, remove ? { method: 'DELETE' } : { method: 'POST', body: JSON.stringify({ verdict, note }) });
      if (!remove) setSaved(true); onChange();
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'failed'); }
    finally { setBusy(''); }
  };
  return <div className="showcase-review">
    <video src={`${PATH}/${clip.id}/media`} controls preload="metadata" aria-label={c.preview} onError={() => setPlaybackError(true)} />
    {playbackError && <p role="alert">{c.playback}</p>}
    <p>{c.expires}: {new Date(clip.expires_at).toLocaleString(locale)}</p>
    <form onSubmit={event => { event.preventDefault(); void act(); }}>
      <h2>{c.review}</h2><label>{c.verdict}<select value={verdict} onChange={event => { setVerdict(event.target.value as NonNullable<Clip['verdict']>); setSaved(false); }}>
        <option value="good">{c.good}</option><option value="partial">{c.partial}</option><option value="bad">{c.bad}</option>
      </select></label>
      <label>{c.note}<textarea value={note} maxLength={2000} rows={4} onChange={event => { setNote(event.target.value); setSaved(false); }} /></label>
      <div className="showcase-actions"><button className="workspace-button workspace-button-primary" disabled={!!busy}>{busy === 'review' ? c.saving : c.save}</button>
        <button type="button" className="workspace-button" disabled={!!busy} onClick={() => void act(true)}>{busy === 'delete' ? c.deleting : c.delete}</button></div>
      {saved && <p role="status">{c.saved}</p>}{error && <p role="alert">{c[error as keyof typeof c] ?? c.failed}</p>}
    </form>
  </div>;
}
