/**
 * Engineering → Debug delivery. One session directory, from this PC, through
 * the phone's own route.
 *
 * WHAT THIS PAGE IS FOR
 *
 * Path A is the collector app pushing a recorded session into the cloud, and
 * until now the only way to watch it happen was to hold an Android phone with a
 * TF card in it. That is a bad place to discover that a signed URL expired, or
 * that the bucket has no CORS rule, or that the read-back disagreed with the
 * phone's digest. This page puts the same state machine
 * (`@playerone/delivery`, shared with the app) behind a browser file picker, so
 * the whole delivery can be driven from an operator's desk.
 *
 * WHAT IS REAL, WHICH IS EVERYTHING
 *
 *   - The collector signs in through `POST /auth/collector/request-code` and
 *     `POST /auth/collector/verify`. No token is minted here.
 *   - The delivery is registered UNMEASURED, exactly as a phone must: a
 *     directory name and every file with its size and digest, and no duration,
 *     no stream count and no amount. The server measures.
 *   - The bytes go from this browser straight to the object store on the
 *     server's own signed URLs. They do not pass through the API.
 *   - `/complete` makes the server read every object back and re-hash it. The
 *     verdict shown is that read-back's, in the server's own words.
 *
 * WHAT IT IS NOT
 *
 * It is not a second upload path and it is not an operator writing an episode.
 * There is no route here that the app does not use, and the page cannot do
 * anything a collector could not do with their own phone. It is shown only
 * where the server reports `PLAYERONE_DEBUG_DELIVERY=1`, and only to an active
 * administrator, because a tool that signs in as somebody else belongs on a
 * demonstration machine and not on a production console.
 */
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import i18next from 'i18next';
import { ApiError as DeliveryError, runDelivery, type DeliveryRecord, type DeliveryStep } from '@playerone/delivery';
import { AppShell } from '../components/shell/AppShell.tsx';
import { useOperatorProfile } from '../lib/profile-api.ts';
import { uuid } from '../lib/uuid.ts';
import { engineering } from '../engineering/api.ts';
import { CollectorWire } from './wire.ts';
import {
  browserTransport,
  hashSession,
  localDeliveryStore,
  pickedSession,
  resumable,
  type PickedSession,
} from './transport.ts';
import '../engineering/engineering.css';
import './debug-delivery.css';

/**
 * A refusal code to a sentence, and the raw code when there is no sentence.
 *
 * Three sources, in order, and the order is the point. This page's own
 * `debug_*` codes come from its own copy. Everything the SERVER names is
 * looked up in the shared catalogue at `bo.refused.<code>`, which already
 * carries all three locales for every upload refusal. Anything else is printed
 * as the server wrote it — a reason a delivery was refused on is not somewhere
 * to print "an error occurred" because a catalogue was not updated.
 */
const OWN_KEYS: Record<string, string> = {
  debug_pick_empty: 'workspace.dbgReasonPickEmpty',
  debug_pick_many_roots: 'workspace.dbgReasonManyRoots',
  debug_pick_nested: 'workspace.dbgReasonNested',
  session_basename_unrecognised: 'workspace.dbgReasonBadName',
  debug_transport_blocked: 'workspace.dbgReasonBlocked',
  debug_collector_unauthorized: 'workspace.dbgReasonUnauthorized',
  debug_unknown_state: 'workspace.dbgReasonUnknownState',
  debug_storage_unconfigured: 'workspace.dbgReasonStorage',
  debug_read_short: 'workspace.dbgReasonReadShort',
  credentials: 'workspace.dbgReasonCredentials',
  rate_limited: 'workspace.dbgReasonRateLimited',
};

function sentence(code: string): string {
  const own = OWN_KEYS[code];
  if (own !== undefined) return i18next.t(own);
  const shared = `bo.refused.${code}`;
  return i18next.exists(shared) ? i18next.t(shared) : code;
}

const reasonOf = (error: unknown): string =>
  error instanceof DeliveryError ? sentence(error.code) : String((error as Error)?.message ?? error);

const bytes = (locale: string, n: number) => new Intl.NumberFormat(locale).format(n);

export function DebugDeliveryScreen() {
  const { t } = useTranslation();
  const c = (key: string) => t(`workspace.${key}`);
  const profile = useOperatorProfile();
  const status = useQuery({ queryKey: ['engineering', 'status'], queryFn: engineering.status, retry: false });

  const administrator =
    profile.data?.operator.role === 'administrator' && profile.data.operator.status === 'active';
  /**
   * Both gates, and neither is this page's own idea of security: the server
   * refuses `/api/engineering/status` to anybody but an active administrator,
   * and it is the server that says whether this deployment wants the page.
   * Rendering it on a `403` or on a server that never set the flag would be
   * offering a tool that cannot work and should not exist here.
   */
  const shown = administrator && status.data?.debug_delivery === true;

  return (
    <AppShell>
      <div className="engineering-page">
        <header className="workspace-page-header">
          <div>
            <h1>{c('dbg')}</h1>
            <p>{c('dbgNote')}</p>
          </div>
          <span className="engineering-readonly">{c('engineering')}</span>
        </header>
        {profile.isPending || status.isPending ? (
          <p role="status" className="engineering-loading">
            {c('loading')}
          </p>
        ) : !shown ? (
          <section className="engineering-notice">
            <h2>{c('engineeringRestricted')}</h2>
            <p>{c('engineeringRestrictedBody')}</p>
          </section>
        ) : (
          <Delivery />
        )}
      </div>
    </AppShell>
  );
}

function Delivery() {
  const { t, i18n } = useTranslation();
  const c = (key: string) => t(`workspace.${key}`);
  const queryClient = useQueryClient();

  /**
   * One wire for the life of the page, holding the collector token in memory.
   * A ref and not state: replacing it on every render would throw the token
   * away, and the token is the one thing here that cannot be fetched again
   * without a code.
   */
  const wire = useRef(new CollectorWire()).current;
  const [signedIn, setSignedIn] = useState(false);

  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [codeFromServer, setCodeFromServer] = useState<boolean | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [picked, setPicked] = useState<PickedSession | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [hashed, setHashed] = useState<{ done: number; total: number; bytes: number } | null>(null);
  const [step, setStep] = useState<DeliveryStep | null>(null);
  /** The id this page chose, so the verdict block can name it whatever happened. */
  const [uploadId, setUploadId] = useState<string | null>(null);

  const held = useQuery({ queryKey: ['dbg', 'held'], queryFn: () => localDeliveryStore.get() });
  const sessions = useQuery({
    queryKey: ['dbg', 'sessions'],
    queryFn: () => wire.sessions(),
    enabled: signedIn,
    retry: false,
  });
  const claims = useQuery({
    queryKey: ['dbg', 'claims'],
    queryFn: () => wire.claims(),
    enabled: signedIn,
    retry: false,
  });
  const devices = useQuery({
    queryKey: ['dbg', 'devices'],
    queryFn: () => wire.devices(),
    enabled: signedIn,
    retry: false,
  });

  const requestCode = useMutation({
    mutationFn: () => wire.requestCode(phone.trim()),
    onSuccess: (demo) => {
      setCodeFromServer(demo !== null);
      if (demo !== null) setCode(demo);
    },
  });

  const verify = useMutation({
    mutationFn: () => wire.verify(phone.trim(), code.trim()),
    onSuccess: () => setSignedIn(true),
  });

  const declare = useMutation({
    mutationFn: async () => {
      const claim = (claims.data ?? [])[0];
      const device = (devices.data ?? [])[0];
      if (claim === undefined || device === undefined) throw new DeliveryError('debug_no_claim');
      return await wire.createSession({
        // Client-generated, like every other mutation a disconnected client
        // makes: `POST /api/me/sessions` is `onConflictDoNothing` on this id,
        // so a retry over a dropped answer stays one session.
        id: uuid(),
        taskId: claim.taskId,
        deviceSerial: device.serial,
        scenario: 'home',
      });
    },
    onSuccess: async (session) => {
      setSessionId(session.id);
      await queryClient.invalidateQueries({ queryKey: ['dbg', 'sessions'] });
    },
  });

  const deliver = useMutation({
    /**
     * Hash, register, send, complete, and report the server's verdict. One
     * mutation for the whole delivery, driven from a button — never from an
     * effect. A transfer must not start because a screen mounted.
     */
    mutationFn: async (resume: DeliveryRecord | null) => {
      if (picked === null) throw new DeliveryError('debug_pick_empty');
      const handles = new Map(picked.files.map((f) => [f.relativePath, f.file]));
      const deps = { api: wire, transport: browserTransport(handles), store: localDeliveryStore };
      if (resume !== null) {
        setUploadId(resume.uploadId);
        return await runDelivery(deps, resume, { resume: true, report: setStep });
      }
      if (sessionId === null) throw new DeliveryError('upload_not_ready');
      const files = await hashSession(picked.files, (done, total, hashedBytes) =>
        setHashed({ done, total, bytes: hashedBytes }),
      );
      const id = uuid();
      setUploadId(id);
      const record: DeliveryRecord = {
        uploadId: id,
        collectionSessionId: sessionId,
        sessionBasename: picked.sessionBasename,
        // The browser has no reopenable handle on a picked folder. The state
        // machine never dereferences this; `browserTransport` resolves the
        // per-file `uri` through the map above.
        directoryUri: picked.sessionBasename,
        files,
      };
      return await runDelivery(deps, record, { report: setStep });
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ['dbg', 'held'] });
    },
  });

  const onPick = (list: FileList | null) => {
    setPickError(null);
    setHashed(null);
    setStep(null);
    deliver.reset();
    try {
      setPicked(pickedSession(list === null ? [] : Array.from(list)));
    } catch (err) {
      setPicked(null);
      setPickError(reasonOf(err));
    }
  };

  const outcome = deliver.data ?? null;
  const running = deliver.isPending;
  const resume = held.data !== null && held.data !== undefined && picked !== null && resumable(held.data, picked)
    ? held.data
    : null;
  const total = (picked?.files ?? []).reduce((sum, f) => sum + f.bytes, 0);

  return (
    <>
      <section className="engineering-section">
        <header className="engineering-heading">
          <div>
            <h2>{c('dbgPrereq')}</h2>
            <p>{c('dbgWhyNote')}</p>
          </div>
        </header>
        <ul className="dbg-steps">
          <li>{c('dbgPrereqCors').replace('{{origin}}', window.location.origin)}</li>
          <li>{c('dbgPrereqClip')}</li>
        </ul>
      </section>

      <section className="engineering-section">
        <header className="engineering-heading">
          <div>
            <h2>{c('dbgSignIn')}</h2>
            <p>{c('dbgSignInNote')}</p>
          </div>
        </header>
        <form
          className="engineering-lookup"
          onSubmit={(event) => {
            event.preventDefault();
            requestCode.mutate();
          }}
        >
          <label htmlFor="dbg-phone">
            {c('dbgPhone')}
            <input
              id="dbg-phone"
              name="phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              inputMode="tel"
              placeholder="+84…"
            />
          </label>
          <button type="submit" className="workspace-button" disabled={phone.trim() === '' || requestCode.isPending}>
            {c('dbgRequestCode')}
          </button>
        </form>
        {requestCode.isError ? (
          <p className="engineering-error" role="alert">
            {reasonOf(requestCode.error)}
          </p>
        ) : null}
        {codeFromServer !== null ? <p className="engineering-meta">{c(codeFromServer ? 'dbgCodeFilled' : 'dbgCodeSilent')}</p> : null}
        <form
          className="engineering-lookup"
          onSubmit={(event) => {
            event.preventDefault();
            verify.mutate();
          }}
        >
          <label htmlFor="dbg-code">
            {c('dbgCode')}
            <input
              id="dbg-code"
              name="code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              autoComplete="off"
              spellCheck={false}
              inputMode="numeric"
            />
          </label>
          <button
            type="submit"
            className="workspace-button workspace-button-primary"
            disabled={code.trim() === '' || phone.trim() === '' || verify.isPending}
          >
            {c('dbgVerify')}
          </button>
          {signedIn ? (
            <button
              type="button"
              className="workspace-button"
              disabled={running}
              onClick={() => {
                wire.signOut();
                setSignedIn(false);
                setSessionId(null);
              }}
            >
              {c('dbgForget')}
            </button>
          ) : null}
        </form>
        {verify.isError ? (
          <p className="engineering-error" role="alert">
            {reasonOf(verify.error)}
          </p>
        ) : null}
        {signedIn ? (
          <p className="engineering-meta" data-testid="dbg-signed-in">
            {c('dbgSignedIn')}
          </p>
        ) : null}
      </section>

      {signedIn ? (
        <section className="engineering-section">
          <header className="engineering-heading">
            <div>
              <h2>{c('dbgSession')}</h2>
              <p>{c('dbgSessionNote')}</p>
            </div>
          </header>
          {sessions.isError ? (
            <p className="engineering-error" role="alert">
              {reasonOf(sessions.error)}
            </p>
          ) : null}
          <div className="dbg-choices">
            {(sessions.data ?? []).map((session) => (
              <button
                key={session.id}
                type="button"
                className="workspace-button"
                aria-pressed={sessionId === session.id}
                data-selected={sessionId === session.id}
                disabled={running}
                onClick={() => setSessionId(session.id)}
              >
                <code>{session.id.slice(0, 8)}</code> · {session.scenario} · {session.createdAt.slice(0, 10)}
              </button>
            ))}
          </div>
          {(sessions.data ?? []).length === 0 && !sessions.isPending ? (
            <p className="engineering-empty">{c('dbgNoSessions')}</p>
          ) : null}
          <div className="engineering-probe">
            <div>
              <h3>{c('dbgDeclare')}</h3>
              <p>{c('dbgDeclareNote')}</p>
            </div>
            <button
              type="button"
              className="workspace-button"
              disabled={running || declare.isPending}
              onClick={() => declare.mutate()}
            >
              {c('dbgDeclare')}
            </button>
          </div>
          {declare.isError ? (
            <p className="engineering-error" role="alert">
              {declare.error instanceof DeliveryError && declare.error.code === 'debug_no_claim'
                ? c('dbgNoClaim')
                : reasonOf(declare.error)}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="engineering-section">
        <header className="engineering-heading">
          <div>
            <h2>{c('dbgPick')}</h2>
            <p>{c('dbgPickNote')}</p>
          </div>
        </header>
        {/*
          `webkitdirectory` is the platform's own directory picker and the only
          way a page gets a whole folder without the File System Access API,
          which Safari does not have. React does not know the attribute, hence
          the lower-case spelling in a `ref`-free cast; `directory` and
          `mozdirectory` are the historical siblings and are harmless where
          they are ignored.
        */}
        <input
          id="dbg-directory"
          type="file"
          multiple
          data-testid="dbg-directory"
          /*
            The native control names itself "Choose Files", which says nothing
            about what is being chosen. There is no visible `<label>`: the
            section heading is the label a sighted reader uses, and this is the
            same sentence for somebody who hears the control instead.
          */
          aria-label={c('dbgPickButton')}
          disabled={running}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(event) => onPick(event.target.files)}
        />
        {pickError !== null ? (
          <p className="engineering-error" role="alert" data-testid="dbg-pick-error">
            {pickError}
          </p>
        ) : null}
        {picked !== null ? (
          <dl className="engineering-facts">
            <div>
              <dt>{c('dbgDirectory')}</dt>
              <dd>
                <code>{picked.sessionBasename}</code>
              </dd>
            </div>
            <div>
              <dt>{c('dbgFiles')}</dt>
              <dd>{bytes(i18n.language, picked.files.length)}</dd>
            </div>
            <div>
              <dt>{c('dbgBytes')}</dt>
              <dd>{bytes(i18n.language, total)}</dd>
            </div>
          </dl>
        ) : null}

        {held.data !== null && held.data !== undefined ? (
          <div className="engineering-probe">
            <div>
              <h3>{c('dbgHeld')}</h3>
              <p>{c('dbgHeldNote')}</p>
              <p>
                <code>{held.data.sessionBasename}</code> · <code>{held.data.uploadId}</code>
              </p>
            </div>
            <div className="dbg-actions">
              <button
                type="button"
                className="workspace-button"
                disabled={running || resume === null}
                onClick={() => deliver.mutate(resume)}
              >
                {c('dbgResume')}
              </button>
              <button
                type="button"
                className="workspace-button"
                disabled={running}
                onClick={async () => {
                  await localDeliveryStore.clear();
                  await queryClient.invalidateQueries({ queryKey: ['dbg', 'held'] });
                }}
              >
                {c('dbgDiscard')}
              </button>
            </div>
          </div>
        ) : null}

        <div className="dbg-actions">
          <button
            type="button"
            className="workspace-button workspace-button-primary"
            data-testid="dbg-start"
            disabled={running || picked === null || sessionId === null || !signedIn}
            onClick={() => deliver.mutate(null)}
          >
            {c('dbgStart')}
          </button>
        </div>
        {hashed !== null ? (
          <p className="engineering-meta" role="status">
            {`${c('dbgHashing')} ${hashed.done}/${hashed.total} · ${bytes(i18n.language, hashed.bytes)}`}
          </p>
        ) : null}
        {step !== null ? (
          <p className="engineering-meta" role="status">
            {`${c('dbgSending')} ${step.sentFiles}/${step.totalFiles}${step.state === null ? '' : ` · ${step.state}`}`}
          </p>
        ) : null}
      </section>

      <section className="engineering-section">
        <header className="engineering-heading">
          <div>
            <h2>{c('dbgVerdict')}</h2>
            <p>{c('engineeringRecordNote')}</p>
          </div>
        </header>
        {deliver.isError ? (
          <p className="engineering-error" role="alert" data-testid="dbg-error">
            {reasonOf(deliver.error)}
          </p>
        ) : null}
        {outcome === null ? (
          <p className="engineering-empty">{c('engineeringSelect')}</p>
        ) : (
          <dl className="engineering-facts" data-testid="dbg-verdict">
            <div>
              <dt>{c('dbgState')}</dt>
              {/*
                The server's word, not a translation of it and not a badge this
                page invented. `collector_uploads.state` has seven values and
                the useful thing to read on a debug page is the one the row
                holds.
              */}
              <dd>
                <code data-testid="dbg-state">{outcome.state}</code>
              </dd>
            </div>
            {uploadId === null ? null : (
              <div>
                <dt>{c('dbgUploadId')}</dt>
                <dd>
                  <code data-testid="dbg-upload-id">{uploadId}</code>
                </dd>
              </div>
            )}
            {outcome.heldReason !== null ? (
              <div>
                <dt>{c('dbgReason')}</dt>
                <dd data-testid="dbg-reason">{sentence(outcome.heldReason)}</dd>
              </div>
            ) : null}
            {outcome.failedReason !== null ? (
              <div>
                <dt>{c('dbgReason')}</dt>
                <dd data-testid="dbg-reason">{sentence(outcome.failedReason)}</dd>
              </div>
            ) : null}
            {outcome.episodeId !== null ? (
              <div>
                <dt>{c('dbgEpisodeId')}</dt>
                <dd>
                  <code data-testid="dbg-episode">{outcome.episodeId}</code>
                </dd>
              </div>
            ) : null}
          </dl>
        )}
        {outcome?.state === 'ingested' ? (
          <div className="dbg-landed" data-testid="dbg-ingested">
            <p>{c('dbgIngested')}</p>
            <div className="dbg-actions">
              {outcome.episodeId !== null ? (
                <Link
                  className="workspace-button"
                  to="/engineering"
                  search={{ episode: outcome.episodeId }}
                >
                  {c('dbgOpenEpisode')}
                </Link>
              ) : null}
              <Link className="workspace-button" to="/review">
                {c('dbgOpenQueue')}
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
