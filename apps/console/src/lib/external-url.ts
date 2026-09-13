/**
 * A URL that came from outside this system, rendered as a link only if it is
 * safe to render as one.
 *
 * There is exactly one of those: ZaloPay's Verify Account answer carries
 * `onboarding_url` (-101) or `reform_url` (-406), and the back office puts it
 * in front of an operator because the page is the only way the collector can
 * act on either answer. The API passes the value through — correctly; it is
 * not the API's string to rewrite — so the console received whatever the
 * gateway sent and put it straight into an `href`.
 *
 * `href` is not inert. `javascript:` in an `href` executes in the operator's
 * session on click, and `data:text/html` opens an attacker-authored page on
 * this origin's tab with the console's name in the address bar. Both are one
 * compromised or mistaken gateway response away, and neither needs the operator
 * to do anything except click the button the screen is telling them to click.
 *
 * `https:` only, and an allowlist rather than a denylist on purpose: a list of
 * bad schemes is a list somebody has to keep complete, and the set of schemes
 * a payment gateway may legitimately hand a browser is exactly this one.
 * `http:` is not on it either — this is a payment onboarding page.
 *
 * Null for anything else, including a value that does not parse. The caller
 * shows the string as text instead, so an operator can still read what the
 * gateway said and telephone somebody about it.
 */
export function httpsLink(url: string | null | undefined): string | null {
  if (url === null || url === undefined || url === '') return null;
  try {
    return new URL(url).protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
