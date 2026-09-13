/**
 * The collector's own routes, called from the console with a collector token.
 *
 * This is the same wire `apps/collector/src/api/http.ts` speaks, mapped the
 * same way, and the mapping is duplicated on purpose: that file is a React
 * Native module in another app, and importing it here would drag the collector
 * app's dependency tree into the console's bundle to save fifty lines. What is
 * NOT duplicated is anything that decides anything — the state machine, the
 * digests and the refusal class all come from `@playerone/delivery`.
 *
 * Two rules this file exists to keep:
 *
 * **The collector token never touches storage and never touches a cookie.** It
 * is a constructor field, gone when the tab closes, and every request here is
 * `credentials: 'omit'`. The operator's `HttpOnly` session cookie is for this
 * origin too, so a request that sent both would be presenting two identities;
 * `requireActor` prefers the `Authorization` header, so it would have worked
 * and would have been wrong for the reason that is hard to find later.
 *
 * **A refusal is the server's word, never this file's sentence.** Every non-2xx
 * answer becomes `ApiError(body.constraint)` when the server named a
 * constraint, and the page looks that name up. The two sign-in routes answer
 * deliberately vaguely — one 204 for an enrolled number and an unenrolled one
 * alike, one 401 for every kind of failed verification — and this client keeps
 * them vague, exactly as the phone does.
 */
import {
  ApiError,
  DELIVERY_STATES,
  type DeliveryApi,
  type DeliveryOutcome,
  type DeliveryPlan,
  type DeliveryRecord,
  type DeliveryState,
  type FilePlan,
} from '@playerone/delivery';

export type CollectionSession = {
  id: string;
  taskId: string;
  scenario: string;
  deviceSerial: string;
  createdAt: string;
};

export type Claim = { id: string; taskId: string; taskName: string };
export type BoundDevice = { serial: string; status: string | null };

interface RawFilePlan {
  relative_path: string;
  done?: boolean;
  put_url?: string;
  parts?: { part_number: number; start: number; end: number; url: string }[];
}

interface RawDelivery {
  state?: string;
  episode_id?: string | null;
  held_reason?: string | null;
  failed_reason?: string | null;
  files?: RawFilePlan[];
}

const toState = (state: unknown): DeliveryState => {
  const known = DELIVERY_STATES.find((s) => s === state);
  // Never defaulted. A word this console does not know is not `ingested`, and
  // guessing would eventually show "delivered" for a state the server added
  // meaning the opposite.
  if (known === undefined) throw new ApiError('debug_unknown_state');
  return known;
};

const toPlan = (uploadId: string, res: RawDelivery | undefined): DeliveryPlan => ({
  uploadId,
  state: toState(res?.state),
  episodeId: res?.episode_id ?? null,
  heldReason: res?.held_reason ?? null,
  failedReason: res?.failed_reason ?? null,
  files: (res?.files ?? []).map(
    (f): FilePlan => ({
      relativePath: f.relative_path,
      done: f.done === true,
      putUrl: f.put_url ?? null,
      parts: (f.parts ?? []).map((p) => ({
        partNumber: p.part_number,
        start: p.start,
        end: p.end,
        url: p.url,
      })),
    }),
  ),
});

export class CollectorWire implements DeliveryApi {
  /** In memory only. See the file comment. */
  private token: string | null = null;

  signedIn(): boolean {
    return this.token !== null;
  }

  signOut(): void {
    this.token = null;
  }

  private async send(path: string, method: string, payload?: unknown): Promise<Response> {
    const headers: Record<string, string> = {};
    if (this.token !== null) headers['authorization'] = `Bearer ${this.token}`;
    if (payload !== undefined) headers['content-type'] = 'application/json';
    return fetch(path, {
      method,
      headers,
      body: payload === undefined ? undefined : JSON.stringify(payload),
      // Never the operator cookie. See the file comment.
      credentials: 'omit',
      signal: AbortSignal.timeout(60_000),
    });
  }

  private async req(method: string, path: string, payload?: unknown): Promise<unknown> {
    const res = await this.send(path, method, payload);
    if (res.status === 204) return undefined;
    const text = await res.text();
    let parsed: unknown = undefined;
    if (text !== '') {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = undefined;
      }
    }
    if (res.status >= 200 && res.status < 300) return parsed;
    if (res.status === 401) {
      // The thirty-day token is dead, or this page never had one. Either way
      // the collector half of this page has to sign in again.
      this.token = null;
      throw new ApiError('debug_collector_unauthorized');
    }
    const constraint = (parsed as { constraint?: unknown } | undefined)?.constraint;
    if (typeof constraint === 'string') throw new ApiError(constraint);
    if (res.status === 400) throw new ApiError('invalid_request');
    if (res.status === 429) throw new ApiError('rate_limited');
    if (res.status === 503) throw new ApiError('debug_storage_unconfigured');
    throw new ApiError('server_error');
  }

  // -- sign in (APP-01) ----------------------------------------------------

  /**
   * Ask for the code, and get it back when this deployment is the demo one.
   *
   * `PLAYERONE_DEMO_PHONE` names ONE number whose code comes back in the body,
   * and the route answers 200 instead of its usual 204 only for that number
   * and only once a collector owns it (`packages/api/src/collector.ts`). Every
   * other number answers 204 and says nothing, here as everywhere.
   *
   * A 200 whose body is not exactly six digits is treated as the ordinary 204.
   */
  async requestCode(phone: string): Promise<string | null> {
    const res = await this.send('/auth/collector/request-code', 'POST', { phone });
    if (res.status === 429) throw new ApiError('rate_limited');
    if (res.status === 503) throw new ApiError('sign_in_unavailable');
    if (res.status === 400) throw new ApiError('invalid_request');
    if (res.status < 200 || res.status >= 300) throw new ApiError('server_error');
    if (res.status !== 200) return null;
    const body = (await res.json().catch(() => null)) as { demo_code?: unknown } | null;
    const code = body?.demo_code;
    return typeof code === 'string' && /^\d{6}$/.test(code) ? code : null;
  }

  /** One 401 for a wrong number, a wrong code, an expired code and too many tries. */
  async verify(phone: string, code: string): Promise<void> {
    const res = await this.send('/auth/collector/verify', 'POST', { phone, code });
    if (res.status === 401) throw new ApiError('credentials');
    if (res.status === 429) throw new ApiError('rate_limited');
    if (res.status < 200 || res.status >= 300) throw new ApiError('server_error');
    const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
    if (typeof body?.token !== 'string') throw new ApiError('server_error');
    this.token = body.token;
  }

  // -- what a delivery has to be attributed to (APP-16) --------------------

  async sessions(): Promise<CollectionSession[]> {
    const res = (await this.req('GET', '/api/me/sessions')) as {
      sessions?: {
        id: string;
        task_id: string;
        scenario: string;
        device_serial: string | null;
        created_at: string;
      }[];
    };
    return (res.sessions ?? []).map((s) => ({
      id: s.id,
      taskId: s.task_id,
      scenario: s.scenario,
      deviceSerial: s.device_serial ?? '',
      createdAt: String(s.created_at),
    }));
  }

  async claims(): Promise<Claim[]> {
    const res = (await this.req('GET', '/api/me/claims')) as {
      claims?: { id: string; task_id: string; task_name: string }[];
    };
    return (res.claims ?? []).map((c) => ({ id: c.id, taskId: c.task_id, taskName: c.task_name }));
  }

  async devices(): Promise<BoundDevice[]> {
    const res = (await this.req('GET', '/api/me/devices')) as {
      devices?: { hardware_serial: string; status: string | null }[];
    };
    return (res.devices ?? []).map((d) => ({ serial: d.hardware_serial, status: d.status ?? null }));
  }

  /**
   * APP-16 and APP-17b: the session a recording belongs to, declared before the
   * recording rather than inferred from it.
   *
   * Both declarations are always sent and never defaulted — the route takes
   * `z.boolean()` and not `.default(false)`, so a missing one is a 400 rather
   * than quietly becoming the safe-looking answer. This page sends `false` for
   * both and says so on its face: an operator pushing a folder through the
   * debug page is not a collector answering a consent question, and a page that
   * silently declared "yes, other people are in frame" would be putting a
   * declaration in the record that nobody made.
   */
  async createSession(input: {
    id: string;
    taskId: string;
    deviceSerial: string;
    scenario: string;
  }): Promise<CollectionSession> {
    const res = (await this.req('POST', '/api/me/sessions', {
      id: input.id,
      task_id: input.taskId,
      device_serial: input.deviceSerial,
      scenario: input.scenario,
      others_in_frame: false,
      sensitive_info_present: false,
    })) as { id: string; created_at: string };
    return {
      id: res.id,
      taskId: input.taskId,
      scenario: input.scenario,
      deviceSerial: input.deviceSerial,
      createdAt: String(res.created_at),
    };
  }

  // -- Path A, the three routes the phone uses and nothing else ------------

  /**
   * UPL-01/APP-26. An UNMEASURED delivery: a directory name, and every file in
   * it with its size and digest.
   *
   * No `episode` key, and its absence is the discriminator. The measured shape
   * is Path C's, posted by a console on a machine that has run the engine —
   * this page has not run the engine and is not pretending to. The server
   * measures after it has proven the bytes.
   */
  async registerDelivery(record: DeliveryRecord): Promise<DeliveryPlan> {
    const res = (await this.req('POST', '/api/me/uploads', {
      id: record.uploadId,
      collection_session_id: record.collectionSessionId,
      session_basename: record.sessionBasename,
      files: record.files.map((f) => ({
        relative_path: f.relativePath,
        bytes: f.bytes,
        sha256: f.sha256,
      })),
    })) as RawDelivery;
    return toPlan(record.uploadId, res);
  }

  /** Resume and progress from one route, because the server answers both off one row. */
  async deliveryPlan(uploadId: string): Promise<DeliveryPlan> {
    const res = (await this.req(
      'GET',
      `/api/me/uploads/${encodeURIComponent(uploadId)}`,
    )) as RawDelivery;
    return toPlan(uploadId, res);
  }

  /** UPL-04/05. Read every object back, re-hash it, and measure the session. */
  async completeDelivery(uploadId: string): Promise<DeliveryOutcome> {
    const res = (await this.req(
      'POST',
      `/api/me/uploads/${encodeURIComponent(uploadId)}/complete`,
    )) as RawDelivery;
    const plan = toPlan(uploadId, res);
    return {
      state: plan.state,
      episodeId: plan.episodeId,
      heldReason: plan.heldReason,
      failedReason: plan.failedReason,
    };
  }
}
