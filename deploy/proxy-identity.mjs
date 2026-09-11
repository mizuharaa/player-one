import { isIP } from 'node:net';

/** Trust is deployment configuration, never inferred from request headers.
 * Railway mode requires ingress reachable only through Railway's HTTP edge.
 * Its documented X-Real-IP is a single replaced client address; arbitrary XFF
 * chains (including ones supplied by callers) are never accepted here.
 */
export function clientAddress(req, mode = 'direct') {
  if (mode !== 'direct' && mode !== 'railway') throw new Error('Unknown proxy mode');
  const value = mode === 'railway' ? req.headers['x-real-ip'] : req.socket.remoteAddress;
  if (typeof value !== 'string' || !isIP(value)) return null;
  return value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
}

export function sanitizedForwarding(headers, address, secure) {
  const clean = Object.fromEntries(Object.entries(headers).filter(([name]) => {
    const key = name.toLowerCase();
    return !key.startsWith('x-forwarded-') && !['forwarded', 'x-real-ip', 'cf-connecting-ip', 'true-client-ip'].includes(key);
  }));
  clean['x-forwarded-for'] = address;
  clean['x-forwarded-proto'] = secure ? 'https' : 'http';
  return clean;
}
