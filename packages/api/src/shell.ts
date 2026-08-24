import { HTML_LANG, type Locale } from './i18n.ts';

/**
 * The back office's design system, such as it is, and the page skeleton every
 * screen in it renders into.
 *
 * There was nothing here before this screen, so the tokens are defined once and
 * every later screen consumes them. Four decisions are worth writing down
 * because they are constraints rather than taste, and somebody will otherwise
 * undo them for good-looking reasons.
 *
 * **One theme, and it is dark.** Not a preference: a reviewer's job on this
 * screen includes judging whether footage is too dark or overexposed, and a
 * bright interface beside a video window shifts that judgment. `VQ-DARK` and
 * `VQ-OVEREXPOSED` are reject reasons a collector is paid or not paid on, so
 * chrome that biases them is a money bug wearing a stylesheet. There is
 * deliberately no light variant to switch to.
 *
 * **System fonts only.** Upload centres run on a LAN and the whole service is
 * built to keep working with the link down — the counter workflow is offline
 * tolerant by design. A webfont from a CDN would make the console's typography
 * depend on the internet being up, which is exactly the dependency the rest of
 * the system refuses.
 *
 * **No build step.** Plain CSS custom properties, plain ES modules, served as
 * they are written. The repo runs `.ts` directly through Node's own type
 * stripping and has no bundler; adding one for one screen would put a compile
 * step between an operator and a fix.
 *
 * **Semantic colour is separate from accent.** The three verdict colours mean
 * pass, partial and reject and are used for nothing else, so a green pill
 * always means the same thing. The playhead amber is the only accent, and it is
 * amber because it has to stay visible over arbitrary video content.
 */

/**
 * The tokens. Values live here and nowhere else — a screen that needs a colour
 * or a step that is not in this list should add it here, so the next screen
 * inherits it rather than inventing a near-miss.
 */
export const TOKENS = `
:root {
  /* Ground and surfaces, cool rather than neutral: a true grey next to video
     picks up whatever cast the footage has and reads as a colour shift. */
  --ground: #0F1114;
  --surface: #171A1F;
  --surface-raised: #21252B;
  --surface-sunken: #0A0C0E;
  --line: #2C313A;
  --line-strong: #3C434E;

  --ink: #E9ECF0;
  --ink-dim: #9BA3AE;
  --ink-faint: #6A727D;
  --ink-inverse: #0F1114;

  /* The playhead and focus. Amber survives on top of arbitrary footage, which
     blue and green do not. */
  --accent: #E8B04B;
  --accent-bright: #F0BD5E;
  --accent-dim: #8A6725;

  /* §6.9's three outcomes. Used for verdicts and for nothing else.
     Each has a ground, a dim ground for fills, and an ink that stays legible
     on it — a pill that sets only its background is the usual way a status
     colour ends up unreadable in one of the three states. */
  --pass: #4E9A6B;
  --pass-dim: #2A4E38;
  --pass-ink: #C9E6D5;
  --partial: #C8922E;
  --partial-dim: #5E4415;
  --partial-ink: #F0DCB0;
  --reject: #C4553D;
  --reject-dim: #5C271C;
  --reject-ink: #F0C7BC;

  /* Behind a modal. Deliberately a token: a scrim mixed by eye per screen is
     how two dialogs end up looking like two different products. */
  --scrim: rgba(0, 0, 0, 0.72);

  /* Severity, which is a different axis from verdict: a flag is about the
     recording, a verdict is about the reviewer. */
  --warn: #C8922E;
  --danger: #C4553D;

  --s1: 4px;
  --s2: 8px;
  --s3: 12px;
  --s4: 16px;
  --s5: 24px;
  --s6: 32px;
  --s7: 48px;

  --radius: 4px;
  --radius-lg: 8px;

  --font-ui: -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans SC",
             "Microsoft YaHei", Roboto, "Helvetica Neue", Arial, sans-serif;
  --font-mono: ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas,
               "Liberation Mono", monospace;

  --text-xs: 11px;
  --text-sm: 12px;
  --text-base: 13px;
  --text-md: 15px;
  --text-lg: 20px;
  --text-xl: 28px;

  --shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
`;

/**
 * Reset and shared primitives. Everything below is used by more than one
 * screen; anything used by exactly one belongs in that screen's own stylesheet.
 */
export const BASE_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: var(--font-ui);
  font-size: var(--text-base);
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { margin: 0; font-weight: 600; text-wrap: balance; }
p { margin: 0; }
button, input, textarea, select { font: inherit; color: inherit; }

/* Keyboard focus has to be obvious: this screen is meant to be driven without a
   mouse, so the focus ring is the only cursor there is. */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius);
}

.mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.num  { font-variant-numeric: tabular-nums; }

.label {
  font-size: var(--text-xs);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--ink-faint);
}

.btn {
  display: inline-flex;
  align-items: center;
  gap: var(--s2);
  padding: var(--s2) var(--s4);
  background: var(--surface-raised);
  color: var(--ink);
  border: 1px solid var(--line-strong);
  border-radius: var(--radius);
  cursor: pointer;
}
.btn:hover { background: var(--line); }
.btn[disabled] { opacity: 0.45; cursor: not-allowed; }
.btn-primary {
  background: var(--accent);
  border-color: var(--accent);
  color: var(--ink-inverse);
  font-weight: 600;
}
.btn-primary:hover { background: var(--accent-bright); }

.pill {
  display: inline-flex;
  align-items: center;
  gap: var(--s1);
  padding: 1px var(--s2);
  border-radius: 999px;
  font-size: var(--text-xs);
  border: 1px solid var(--line-strong);
  color: var(--ink-dim);
}
.pill-pass    { background: var(--pass-dim);    border-color: var(--pass);    color: var(--pass-ink); }
.pill-partial { background: var(--partial-dim); border-color: var(--partial); color: var(--partial-ink); }
.pill-reject  { background: var(--reject-dim);  border-color: var(--reject);  color: var(--reject-ink); }

.kbd {
  display: inline-block;
  min-width: 18px;
  padding: 0 5px;
  background: var(--surface-sunken);
  border: 1px solid var(--line-strong);
  border-bottom-width: 2px;
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  text-align: center;
  color: var(--ink-dim);
}

.topbar {
  display: flex;
  align-items: center;
  gap: var(--s4);
  height: 44px;
  padding: 0 var(--s4);
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  flex: none;
}
.topbar .brand { font-weight: 600; letter-spacing: 0.02em; }
.topbar .spacer { flex: 1; }
.topbar .stat { display: flex; align-items: baseline; gap: var(--s2); }
.topbar .stat b { font-family: var(--font-mono); font-variant-numeric: tabular-nums; font-weight: 600; }

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
`;

/**
 * HTML escaping for interpolated text.
 *
 * Applied to every value that reaches a template, including ones that come from
 * the database. A collector reference, a task name and a device serial are all
 * typed by a person at a counter, and "it came from Postgres" is not the same
 * claim as "it is safe to concatenate into markup".
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * U+2028 and U+2029: legal inside a JSON string, and line terminators in
 * JavaScript source. A reject-reason label carrying one would end the statement
 * it is embedded in, mid-string, with no visible cause in an editor.
 */
const JS_LINE_TERMINATORS = /[\u2028\u2029]/g;

export function escapeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replace(JS_LINE_TERMINATORS, (c) => `\\u${c.charCodeAt(0).toString(16)}`);
}

export type PageOptions = {
  locale: Locale;
  title: string;
  body: string;
  /** Extra stylesheet hrefs, in order. The shell's own tokens always come first. */
  styles?: readonly string[];
  /** One ES module, loaded deferred by nature of `type="module"`. */
  module?: string;
  /** Serialised into `window.__PLAYERONE__` for the module to read on start. */
  data?: unknown;
};

export function page({ locale, title, body, styles = [], module, data }: PageOptions): string {
  return `<!doctype html>
<html lang="${HTML_LANG[locale]}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${escapeHtml(title)}</title>
<style>${TOKENS}${BASE_CSS}</style>
${styles.map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`).join('\n')}
</head>
<body>
${body}
${data === undefined ? '' : `<script type="application/json" id="bootstrap">${escapeJson(data)}</script>`}
${module === undefined ? '' : `<script type="module" src="${escapeHtml(module)}"></script>`}
</body>
</html>
`;
}
