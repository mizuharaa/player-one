/**
 * The same two tokens, carried by a browser instead of by a machine client.
 *
 * The counter API was built for a program: it puts a machine token and an
 * operator token in headers on every request. A review console cannot do that
 * for everything it needs. A `<video>` element sets no custom headers, and
 * neither does `navigator.sendBeacon` — which is the only thing that reliably
 * runs on page unload, and so the only way to release a lease when a reviewer
 * closes the tab. Both would be unauthenticated, which for the video means the
 * screen simply does not work.
 *
 * So the tokens get a second transport. This is not a second authorisation
 * model: the same signed claims, checked by the same `verifyToken`, granting
 * exactly the same access. Only the envelope changes.
 *
 * `HttpOnly` so script cannot read them, `SameSite=Strict` so another origin
 * cannot cause a request that carries them, `Path=/` because the media routes
 * do not sit under the console's prefix.
 */

export const MACHINE_COOKIE = 'po_machine';
export const OPERATOR_COOKIE = 'po_operator';

/**
 * A `Cookie` header to a map. Deliberately small and deliberately not a
 * dependency: the header is a well-defined `name=value; name=value` list, and
 * the two names read here are ours.
 *
 * Values are percent-decoded because a signed token is base64url and a
 * conforming client may still encode it. A value that will not decode is
 * returned as it arrived rather than throwing — a malformed cookie should fail
 * signature verification, which is a 401, not blow up the request.
 */
export function parseCookies(header: string | undefined): Record<string, string> {
  const jar: Record<string, string> = {};
  if (header === undefined || header === '') return jar;
  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=');
    if (eq < 1) continue;
    const name = pair.slice(0, eq).trim();
    const raw = pair.slice(eq + 1).trim();
    if (name === '') continue;
    try {
      jar[name] = decodeURIComponent(raw);
    } catch {
      jar[name] = raw;
    }
  }
  return jar;
}

/**
 * `Set-Cookie` for one session token.
 *
 * No `Max-Age`: these last as long as the browser session, so a shared review
 * workstation does not stay signed in after the reviewer walks away. The token
 * carries its own expiry regardless — the cookie is transport, not the
 * lifetime.
 *
 * `Secure` is conditional because the pilot's upload centres are on a LAN over
 * plain HTTP, and a `Secure` cookie there is simply never sent, which presents
 * as a login that silently does nothing.
 */
export function sessionCookie(name: string, value: string, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

/** Clears one, by the same attributes it was set with. */
export function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}
