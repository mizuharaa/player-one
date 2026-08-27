import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Db } from '@playerone/store';
import { clearCookie, MACHINE_COOKIE, OPERATOR_COOKIE, sessionCookie } from './cookies.ts';
import { signToken } from './credentials.ts';
import { HTML_LANG, MESSAGES, pickLocale, t, type Locale, type MessageKey } from './i18n.ts';
import { SIGN_IN_RATE_LIMITED, signInAttempt, type SignInLimiter } from './ratelimit.ts';
import { LEASE_MS } from './review.ts';
import { authenticateMachine, authenticateOperator } from './session.ts';
import { escapeHtml, page } from './shell.ts';

/**
 * The browser side of the back office: sign-in, the review screen's markup, and
 * the two static files it loads.
 *
 * Everything a person reads comes from `i18n.ts` and is rendered here, on the
 * server. The client module fills in values and changes state; it does not
 * carry a second copy of the copy. That is not tidiness — a string that exists
 * in two places drifts in one of them, and half of these strings are shown to
 * PaXini reviewers in Chinese where a stale English fallback is not a style
 * problem but an unreadable screen.
 *
 * There is no framework and no build step here. The page is a template literal,
 * the script is an ES module the browser loads as written, and the stylesheet is
 * plain CSS. htmx is used elsewhere in the back office and is deliberately not
 * used on this screen: its swap model replaces DOM subtrees, and this screen's
 * whole performance argument rests on a `<video>` element that survives from one
 * episode to the next.
 */

const ASSETS = join(import.meta.dirname, '..', 'assets');

const ASSET_TYPES: Record<string, string> = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

export type ConsoleOptions = {
  tokenSecret: string;
  secureCookies: boolean;
  limiter: SignInLimiter;
};

export function registerConsole(app: FastifyInstance, db: Db, options: ConsoleOptions): void {
  /**
   * Fastify parses JSON and nothing else. The sign-in form is a plain HTML
   * `<form>` on purpose — it has to work before any script has run, which is
   * the one page where that matters — so its encoding needs a parser.
   */
  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (err) {
        done(err as Error);
      }
    },
  );

  app.get('/review/assets/:file', async (req, reply) => {
    const { file } = req.params as { file: string };
    // The only names that reach the disk are the two this screen ships.
    if (!/^[a-z0-9.-]+$/.test(file) || file.includes('..')) {
      return reply.code(404).send({ error: 'no such asset' });
    }
    const type = ASSET_TYPES[extname(file).toLowerCase()];
    if (type === undefined) return reply.code(404).send({ error: 'no such asset' });
    try {
      const body = await readFile(join(ASSETS, file), 'utf8');
      return reply
        .code(200)
        .headers({ 'content-type': type, 'cache-control': 'no-cache' })
        .send(body);
    } catch {
      return reply.code(404).send({ error: 'no such asset' });
    }
  });

  // -------------------------------------------------------------------------
  // Sign-in

  app.get('/review/login', async (req, reply) => {
    const locale = pickLocale(req.query, req.headers['accept-language']);
    const failed = (req.query as Record<string, string>)['failed'];
    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(loginPage(locale, failed));
  });

  app.post('/review/login', async (req, reply) => {
    const locale = pickLocale(req.query, req.headers['accept-language']);
    const form = (req.body ?? {}) as Record<string, string>;

    // SEC-03, the same limiter the JSON sign-in uses. The person sees the
    // sentence on the form rather than a bare 429 they cannot read.
    const attempt = signInAttempt(db, options.limiter, req.ip, 'operator.login_failed', [
      form['external_ref'] ?? '',
      form['machine_identifier'] ?? '',
    ]);
    const wait = await attempt.blocked();
    if (wait !== null) {
      return reply
        .code(429)
        .headers({ 'content-type': 'text/html; charset=utf-8', 'retry-after': String(wait) })
        .send(loginPage(locale, SIGN_IN_RATE_LIMITED));
    }

    const machine = await authenticateMachine(
      db,
      form['machine_identifier'] ?? '',
      form['machine_secret'] ?? '',
    );
    const operator = await authenticateOperator(
      db,
      form['external_ref'] ?? '',
      form['operator_secret'] ?? '',
    );
    if (machine === null || operator === null) {
      await attempt.wrong();
      return reply.code(401).header('content-type', 'text/html; charset=utf-8').send(
        loginPage(locale, 'credentials'),
      );
    }
    attempt.ok();
    /**
     * The same centre check the header path makes. Two valid credentials from
     * different centres is either a misconfigured machine or spliced
     * credentials, and it is refused here for the same reason it is refused
     * there — not because the console is more suspicious, but because it is the
     * same rule.
     */
    if (machine.uploadCentreId !== operator.uploadCentreId) {
      return reply.code(403).header('content-type', 'text/html; charset=utf-8').send(
        loginPage(locale, 'mismatch'),
      );
    }

    return reply
      .code(303)
      .headers({
        'set-cookie': [
          sessionCookie(MACHINE_COOKIE, signToken(options.tokenSecret, machine), options.secureCookies),
          sessionCookie(
            OPERATOR_COOKIE,
            signToken(options.tokenSecret, operator),
            options.secureCookies,
          ),
        ],
        location: `/review?lang=${locale}`,
      })
      .send();
  });

  app.post('/review/logout', async (_req, reply) =>
    reply
      .code(303)
      .headers({
        'set-cookie': [clearCookie(MACHINE_COOKIE), clearCookie(OPERATOR_COOKIE)],
        location: '/review/login',
      })
      .send(),
  );

  // -------------------------------------------------------------------------
  // The screen

  /**
   * Not behind `requireActor`.
   *
   * A 401 JSON body is the right answer for an API call and the wrong one for a
   * person who opened a bookmark — they get a blank page with a word on it and
   * no way forward. The page checks the session itself and redirects to the
   * form. Every route it then calls *is* behind `requireActor`, so nothing is
   * readable without credentials; only the empty shell is.
   */
  app.get('/review', async (req, reply) => {
    const locale = pickLocale(req.query, req.headers['accept-language']);
    const cookie = req.headers.cookie ?? '';
    if (!cookie.includes(MACHINE_COOKIE) || !cookie.includes(OPERATOR_COOKIE)) {
      return reply.code(303).header('location', `/review/login?lang=${locale}`).send();
    }
    return reply
      .code(200)
      .header('content-type', 'text/html; charset=utf-8')
      .send(reviewPage(locale));
  });
}

// ---------------------------------------------------------------------------
// Markup

const loginPage = (locale: Locale, failed?: string): string => {
  const m = (key: MessageKey) => escapeHtml(t(locale, key));
  /**
   * The rate-limited sentence is the one the console reads off a refusal name,
   * not a second copy under `login.*`: the form and the SPA say the same thing
   * to the same person about the same event.
   */
  const reason: MessageKey =
    failed === 'mismatch'
      ? 'login.mismatch'
      : failed === SIGN_IN_RATE_LIMITED
        ? `bo.refused.${SIGN_IN_RATE_LIMITED}`
        : 'login.failed';
  const error =
    failed === undefined ? '' : `<p class="login-error" role="alert">${m(reason)}</p>`;
  return page({
    locale,
    title: `${t(locale, 'app.name')} — ${t(locale, 'login.title')}`,
    styles: ['/review/assets/review.css'],
    body: `
<main class="login">
  <form class="login-card" method="post" action="/review/login?lang=${locale}">
    <h1>${m('login.title')}</h1>
    <p class="login-intro">${m('login.intro')}</p>
    ${error}
    <label class="field">
      <span class="label">${m('login.machine')}</span>
      <input name="machine_identifier" autocomplete="username" required autofocus>
    </label>
    <label class="field">
      <span class="label">${m('login.machineSecret')}</span>
      <input name="machine_secret" type="password" autocomplete="current-password" required>
    </label>
    <hr>
    <label class="field">
      <span class="label">${m('login.operator')}</span>
      <input name="external_ref" autocomplete="username" required>
    </label>
    <label class="field">
      <span class="label">${m('login.operatorSecret')}</span>
      <input name="operator_secret" type="password" autocomplete="current-password" required>
    </label>
    <button class="btn btn-primary login-submit" type="submit">${m('login.submit')}</button>
    <nav class="login-langs">
      <a href="/review/login?lang=en" hreflang="en">English</a>
      <a href="/review/login?lang=zh" hreflang="zh-Hans">中文</a>
    </nav>
  </form>
</main>`,
  });
};

/**
 * The review screen's markup: every element the client module will ever need,
 * present from the first paint and empty rather than absent.
 *
 * Rendering the structure once and mutating text nodes is what keeps the
 * `<video>` elements alive across an advance. Building the panel from JavaScript
 * on each episode would recreate them, and a recreated element throws away the
 * buffer that prefetching spent the previous thirty seconds filling — which is
 * the entire throughput argument for this screen.
 */
const reviewPage = (locale: Locale): string => {
  const m = (key: MessageKey) => escapeHtml(t(locale, key));
  return page({
    locale,
    title: `${t(locale, 'app.name')} — ${t(locale, 'app.review')}`,
    styles: ['/review/assets/review.css'],
    module: '/review/assets/review.js',
    data: { locale, lang: HTML_LANG[locale], messages: MESSAGES[locale], leaseMs: LEASE_MS },
    body: `
<div class="app" id="app">
  <header class="topbar">
    <span class="brand">${m('app.name')}</span>
    <span class="label">${m('app.review')}</span>
    <span class="spacer"></span>
    <span class="stat"><span class="label">${m('queue.depth')}</span><b id="queue-depth">—</b></span>
    <span class="stat"><span class="label">${m('queue.average')}</span><b id="queue-average">—</b></span>
    <button class="btn" id="shortcuts-toggle" type="button">
      ${m('shortcuts.show')} <span class="kbd">?</span>
    </button>
    <a class="btn" href="/review?lang=${locale === 'zh' ? 'en' : 'zh'}">${
      locale === 'zh' ? 'English' : '中文'
    }</a>
    <form method="post" action="/review/logout"><button class="btn" type="submit">${m(
      'app.signOut',
    )}</button></form>
  </header>

  <main class="stage" id="stage">
    <section class="viewer">
      <div class="video-frame">
        <!-- Two elements, swapped rather than re-sourced. The hidden one is
             already buffering the next episode while this one is watched. -->
        <video id="video-a" class="video is-live" playsinline preload="auto"></video>
        <video id="video-b" class="video" playsinline preload="auto" muted></video>
        <div class="video-empty" id="video-empty" hidden>${m('player.loading')}</div>
      </div>

      <div class="transport">
        <button class="btn transport-play" id="play" type="button" aria-keyshortcuts="Space">
          ${m('player.play')}
        </button>
        <span class="time mono" id="time">0:00.00 / 0:00.00</span>
        <span class="rate mono" id="rate">1.00&times;</span>
        <span class="spacer"></span>
        <span class="part-indicator label" id="part-indicator"></span>
      </div>

      <!-- The scrub bar is custom because native controls take keyboard focus
           and would swallow every shortcut on this screen. -->
      <div class="scrub" id="scrub" role="slider" tabindex="0"
           aria-label="${m('player.position')}" aria-valuemin="0" aria-valuenow="0" aria-valuemax="0">
        <div class="scrub-track">
          <div class="scrub-buffered" id="scrub-buffered"></div>
          <div class="scrub-spans" id="scrub-spans"></div>
          <div class="scrub-parts" id="scrub-parts"></div>
          <div class="scrub-pending" id="scrub-pending" hidden></div>
          <div class="scrub-head" id="scrub-head"></div>
        </div>
      </div>

      <div class="marking">
        <div class="marking-actions">
          <button class="btn" id="mark-in" type="button">${m('mark.in')} <span class="kbd">I</span></button>
          <button class="btn" id="mark-out" type="button">${m('mark.out')} <span class="kbd">O</span></button>
          <button class="btn" id="mark-clear" type="button">${m('mark.clear')} <span class="kbd">X</span></button>
          <span class="marking-hint" id="marking-hint" role="status"></span>
        </div>
        <div class="marking-total">
          <span class="label">${m('mark.estimate')}</span>
          <b class="mono" id="estimate-duration">0:00.00</b>
          <span class="mono" id="estimate-amount"></span>
          <span class="marking-caveat">${m('mark.estimateHint')}</span>
        </div>
      </div>

      <ol class="spans" id="spans" aria-live="polite">
        <li class="spans-empty">${m('mark.none')}</li>
      </ol>
    </section>

    <aside class="panel" id="panel">
      <dl class="meta" id="meta"></dl>
      <section class="flags" id="flags"></section>
      <section class="recent">
        <h2 class="label">${m('recent.title')}</h2>
        <ol id="recent"><li class="spans-empty">${m('recent.empty')}</li></ol>
      </section>
    </aside>
  </main>

  <footer class="verdict" id="verdict">
    <div class="verdict-choices" role="radiogroup" aria-label="${m('app.review')}">
      <button class="btn verdict-good" id="verdict-good" type="button" role="radio" aria-checked="false">
        <span class="kbd">1</span> ${m('verdict.good')}
      </button>
      <button class="btn verdict-partial" id="verdict-partial" type="button" role="radio" aria-checked="false">
        <span class="kbd">2</span> ${m('verdict.partial')}
      </button>
      <button class="btn verdict-bad" id="verdict-bad" type="button" role="radio" aria-checked="false">
        <span class="kbd">3</span> ${m('verdict.bad')}
      </button>
    </div>
    <div class="verdict-reasons" id="reasons-wrap" hidden>
      <span class="label">${m('verdict.reasons')}</span>
      <div class="reasons" id="reasons"></div>
    </div>
    <input class="verdict-note" id="note" placeholder="${m('verdict.note')}" maxlength="2000">
    <span class="verdict-error" id="verdict-error" role="alert"></span>
    <button class="btn btn-primary verdict-commit" id="commit" type="button" disabled>
      ${m('verdict.commit')} <span class="kbd">&crarr;</span>
    </button>
  </footer>

  <!-- Named states, not ad-hoc branches. Each one is a full-stage panel that
       says what happened and what to do about it. -->
  <div class="screen" id="screen-empty" hidden>
    <h2>${m('queue.empty.title')}</h2>
    <p>${m('queue.empty.body')}</p>
    <button class="btn btn-primary" id="empty-retry" type="button">${m('queue.refresh')}</button>
  </div>
  <div class="screen" id="screen-media" hidden>
    <h2>${m('state.mediaFailed.title')}</h2>
    <p>${m('state.mediaFailed.body')}</p>
    <button class="btn btn-primary" id="media-skip" type="button">${m('state.mediaFailed.action')}</button>
  </div>
  <div class="screen" id="screen-load" hidden>
    <h2>${m('state.loadFailed.title')}</h2>
    <p id="screen-load-detail"></p>
    <button class="btn btn-primary" id="load-retry" type="button">${m('queue.refresh')}</button>
  </div>

  <!-- Blocking, not a toast. A verdict that vanished is a payment that vanished,
       and it must not be possible to keep working past one. -->
  <div class="blocker" id="blocker" hidden role="alertdialog" aria-modal="true">
    <div class="blocker-card">
      <h2 id="blocker-title"></h2>
      <p id="blocker-body"></p>
      <div class="blocker-actions">
        <button class="btn btn-primary" id="blocker-primary" type="button"></button>
        <button class="btn" id="blocker-secondary" type="button" hidden></button>
      </div>
    </div>
  </div>

  <div class="shortcuts" id="shortcuts" hidden>
    <h2>${m('shortcuts.title')}</h2>
    <dl>
      <dt><span class="kbd">${m('shortcuts.spaceKey')}</span></dt><dd>${m('shortcuts.playPause')}</dd>
      <dt><span class="kbd">&larr;</span> <span class="kbd">&rarr;</span></dt><dd>${m('shortcuts.seek')}</dd>
      <dt><span class="kbd">&#8679;&larr;</span> <span class="kbd">&#8679;&rarr;</span></dt><dd>${m('shortcuts.frame')}</dd>
      <dt><span class="kbd">J</span> <span class="kbd">L</span></dt><dd>${m('shortcuts.rate')}</dd>
      <dt><span class="kbd">I</span></dt><dd>${m('shortcuts.markIn')}</dd>
      <dt><span class="kbd">O</span></dt><dd>${m('shortcuts.markOut')}</dd>
      <dt><span class="kbd">X</span></dt><dd>${m('shortcuts.clear')}</dd>
      <dt><span class="kbd">1</span> <span class="kbd">2</span> <span class="kbd">3</span></dt><dd>${m('shortcuts.verdict')}</dd>
      <dt><span class="kbd">&crarr;</span></dt><dd>${m('shortcuts.commit')}</dd>
      <dt><span class="kbd">?</span></dt><dd>${m('shortcuts.help')}</dd>
    </dl>
  </div>
</div>`,
  });
};
