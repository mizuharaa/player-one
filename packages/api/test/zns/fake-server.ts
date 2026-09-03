import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import { ZNS_SEND_PATH, type ZnsConfig } from '../../src/zns.ts';

/**
 * A Zalo Notification Service that runs on 127.0.0.1 and can be told how to
 * misbehave. Test-only, and the reason nothing in the suite touches the
 * network.
 *
 * The same shape as `test/payout/zalopay/fake-server.ts`, for the same reason:
 * behaviour is a SCENARIO QUEUE, consumed one entry per request, falling back
 * to `defaultScenario` when it is empty. The queue can hold every error code
 * in `ZNS_ERROR_CODES`, a code that is in no table at all, a hang past the
 * client's budget, a socket reset mid-body, a truncated JSON body and an
 * arbitrary HTTP status.
 *
 * Every request is recorded in `received`, with the access token it carried, so
 * a test can assert what was sent as well as what came back. `received.length`
 * is how "nothing was sent twice" is asserted.
 */

export type ZnsScenario =
  /** `error: 0`. */
  | { kind: 'ok'; msgId?: string }
  /** A ZNS business refusal. */
  | { kind: 'error'; error: number; message?: string }
  /** Hold the response open. Default 20 000 ms — past any sane client budget. */
  | { kind: 'hang'; ms?: number }
  /** Headers and half a body, then destroy the socket. */
  | { kind: 'reset' }
  /** A complete 200 whose JSON body stops halfway. */
  | { kind: 'truncated' }
  /** Something in front of ZNS answered instead. */
  | { kind: 'http'; status: number; body?: string; contentType?: string };

export type ZnsReceived = {
  seq: number;
  accessToken: string | null;
  body: Record<string, unknown>;
  scenario: ZnsScenario;
};

export class FakeZns {
  readonly accessToken: string;
  readonly templateId: string;
  /** Consumed front to back, one per request. */
  readonly queue: ZnsScenario[] = [];
  /** What answers when the queue is empty. */
  defaultScenario: ZnsScenario = { kind: 'ok' };
  readonly received: ZnsReceived[] = [];

  private readonly app: FastifyInstance;
  private readonly timers = new Set<NodeJS.Timeout>();
  private seq = 0;
  baseUrl = '';

  constructor(options: { accessToken?: string; templateId?: string } = {}) {
    this.accessToken = options.accessToken ?? 'ZNS-TEST-ACCESS-TOKEN';
    this.templateId = options.templateId ?? 'tpl-signin-otp';
    // forceCloseConnections: a hung reply is a socket that would otherwise keep
    // `close()` waiting for the client's whole budget.
    this.app = Fastify({ logger: false, forceCloseConnections: true });
    this.app.post(ZNS_SEND_PATH, (req, reply) => this.handle(req, reply));
  }

  async start(): Promise<this> {
    this.baseUrl = await this.app.listen({ port: 0, host: '127.0.0.1' });
    return this;
  }

  async close(): Promise<void> {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    await this.app.close();
  }

  /** A `znsSender` configuration that talks to this fake. Spread it and override. */
  clientConfig(): ZnsConfig {
    return {
      accessToken: this.accessToken,
      templateId: this.templateId,
      baseUrl: this.baseUrl,
      timeoutMs: 2_000,
    };
  }

  /** Queue scenarios for the NEXT sends, in order. */
  plan(...scenarios: ZnsScenario[]): this {
    this.queue.push(...scenarios);
    return this;
  }

  reset(): void {
    this.queue.length = 0;
    this.received.length = 0;
    this.defaultScenario = { kind: 'ok' };
  }

  /** The `template_data` of the last request, which is where the code would be. */
  lastTemplateData(): Record<string, unknown> {
    const last = this.received.at(-1);
    return (last?.body['template_data'] ?? {}) as Record<string, unknown>;
  }

  // -------------------------------------------------------------------------

  private async handle(req: FastifyRequest, reply: FastifyReply): Promise<unknown> {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const scenario = this.queue.shift() ?? this.defaultScenario;
    const header = req.headers['access_token'];
    this.received.push({
      seq: ++this.seq,
      accessToken: typeof header === 'string' ? header : null,
      body,
      scenario,
    });

    switch (scenario.kind) {
      case 'hang': {
        reply.hijack();
        const t = setTimeout(() => {
          this.timers.delete(t);
          if (!reply.raw.destroyed) this.raw(reply, 200, this.envelope(-115, 'SYSTEM_ERROR'));
        }, scenario.ms ?? 20_000);
        this.timers.add(t);
        return;
      }
      case 'reset': {
        reply.hijack();
        const text = this.envelope(0, 'Success');
        reply.raw.writeHead(200, { 'content-type': 'application/json' });
        reply.raw.write(text.slice(0, Math.floor(text.length / 2)));
        reply.raw.socket?.destroy();
        return;
      }
      case 'truncated': {
        reply.hijack();
        const text = this.envelope(0, 'Success');
        this.raw(reply, 200, text.slice(0, Math.floor(text.length / 2)));
        return;
      }
      case 'http': {
        reply.hijack();
        this.raw(reply, scenario.status, scenario.body ?? '', scenario.contentType ?? 'text/html');
        return;
      }
      default:
        break;
    }

    // A wrong token is a real -124, exactly as ZNS would answer, rather than
    // something only this fake knows how to do.
    if (this.received.at(-1)!.accessToken !== this.accessToken) {
      return reply.code(200).type('application/json').send(this.envelope(-124, 'Invalid access token'));
    }
    if (scenario.kind === 'error') {
      return reply
        .code(200)
        .type('application/json')
        .send(this.envelope(scenario.error, scenario.message ?? 'refused'));
    }
    return reply
      .code(200)
      .type('application/json')
      .send(
        JSON.stringify({
          error: 0,
          message: 'Success',
          data: { msg_id: scenario.msgId ?? `MSG-${this.seq}`, sent_time: String(Date.now()) },
        }),
      );
  }

  private envelope(error: number, message: string): string {
    return JSON.stringify({ error, message, data: error === 0 ? { msg_id: `MSG-${this.seq}` } : null });
  }

  private raw(reply: FastifyReply, status: number, text: string, contentType = 'application/json'): void {
    reply.raw.writeHead(status, { 'content-type': contentType, 'content-length': String(Buffer.byteLength(text)) });
    reply.raw.end(text);
  }
}

/** Start one and hand it back. `await fake.close()` in `afterAll`. */
export async function startFakeZns(options: { accessToken?: string; templateId?: string } = {}): Promise<FakeZns> {
  return new FakeZns(options).start();
}
