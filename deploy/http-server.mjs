import { createServer, request as httpRequest } from 'node:http';
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { pipeline } from 'node:stream';
import { clientAddress, sanitizedForwarding } from './proxy-identity.mjs';

const API_ROOTS = ['/api', '/auth', '/media', '/whoami', '/reference', '/handovers', '/upload-batches'];
const HOP_HEADERS = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade']);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
};

export function isApiPath(pathname) {
  return pathname.startsWith('/episodes/') || API_ROOTS.some((root) => pathname === root || pathname.startsWith(`${root}/`));
}

function cleanHeaders(headers) {
  const blocked = new Set(HOP_HEADERS);
  for (const name of String(headers.connection ?? '').split(',')) blocked.add(name.trim().toLowerCase());
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !blocked.has(name.toLowerCase())));
}

function send(res, status, message, headers = {}) {
  const body = JSON.stringify({ error: message });
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(body);
}

function parsePath(rawUrl) {
  const rawPath = rawUrl.split('?')[0];
  if (!rawPath?.startsWith('/') || rawPath.startsWith('//')) throw new Error('invalid_path');
  const pathname = decodeURIComponent(rawPath);
  if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some((part) => part === '..' || part === '.')) {
    throw new Error('invalid_path');
  }
  return pathname;
}

function isInside(root, file) { return file === root || file.startsWith(`${root}${sep}`); }

/** Single byte ranges cover native browser seeking without buffering MP4s. */
export function byteRange(header, size) {
  if (!header || header.includes(',')) return null; // Multiple ranges may be ignored by a server.
  if (!header.startsWith('bytes=')) return null; // Unknown units must be ignored.
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2]) || size === 0) return false;
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return false;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || start > end) return false;
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

function proxy(req, res, apiPort, proxyMode, secure) {
  const address = clientAddress(req, proxyMode);
  if (!address) { send(res, 400, 'invalid_client_address'); return; }
  const upstream = httpRequest({ host: '127.0.0.1', port: apiPort, path: req.url,
    method: req.method, headers: sanitizedForwarding(cleanHeaders(req.headers), address, secure) }, (reply) => {
    res.writeHead(reply.statusCode ?? 502, cleanHeaders(reply.headers));
    pipeline(reply, res, () => {});
  });
  upstream.setTimeout(120_000, () => upstream.destroy(new Error('upstream_timeout')));
  upstream.on('error', () => {
    if (!res.headersSent) send(res, 502, 'api_unavailable');
    else res.destroy();
  });
  req.on('aborted', () => upstream.destroy());
  res.on('close', () => { if (!res.writableEnded) upstream.destroy(); });
  req.pipe(upstream);
}

function apiReady(apiPort) {
  return new Promise((resolveReady) => {
    const request = httpRequest({ host: '127.0.0.1', port: apiPort, path: '/whoami', method: 'GET' }, (reply) => {
      // The existing authenticated route returns 401 to this credential-free probe.
      resolveReady(reply.statusCode === 401);
      reply.resume();
    });
    request.setTimeout(1500, () => request.destroy());
    request.on('error', () => resolveReady(false));
    request.end();
  });
}

export async function createShowcaseServer({ distDir, apiPort, secure = false, proxyMode = 'direct' }) {
  if (!['direct', 'railway'].includes(proxyMode)) throw new Error('Unsupported proxy mode');
  const root = await realpath(distDir);
  const indexFile = await realpath(resolve(root, 'index.html'));
  if (!isInside(root, indexFile)) throw new Error('index.html escapes the static root');
  const server = createServer(async (req, res) => {
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
    res.setHeader('x-frame-options', 'DENY');
    // React/GSAP require inline styles, but scripts must come from this build.
    // HTTPS media supports the existing signed object-store playback contract.
    res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: https:; connect-src 'self' blob:; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    if (secure) res.setHeader('strict-transport-security', 'max-age=31536000');
    let pathname;
    try { pathname = parsePath(req.url ?? '/'); } catch { send(res, 400, 'invalid_path'); return; }

    if (pathname === '/healthz') {
      if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, 'method_not_allowed', { allow: 'GET, HEAD' }); return; }
      const ready = await apiReady(apiPort);
      res.writeHead(ready ? 200 : 503, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ ready }));
      return;
    }
    if (isApiPath(pathname)) { proxy(req, res, apiPort, proxyMode, secure); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') { send(res, 405, 'method_not_allowed', { allow: 'GET, HEAD' }); return; }
    // Source maps and dotfiles are never part of the public showcase contract.
    if (pathname.endsWith('.map') || pathname.split('/').some((part) => part.startsWith('.'))) {
      send(res, 404, 'not_found'); return;
    }

    try {
      let file = resolve(root, `.${pathname}`);
      if (!isInside(root, file)) { send(res, 400, 'invalid_path'); return; }
      let info;
      try {
        file = await realpath(file);
        if (!isInside(root, file)) { send(res, 404, 'not_found'); return; }
        info = await stat(file);
        if (!info.isFile()) info = undefined;
      } catch (error) {
        if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
      }
      if (!info) {
        // Asset misses must not become 200 text/html (especially video errors).
        if (extname(pathname) || pathname.startsWith('/assets/') || pathname.startsWith('/discover/')) {
          send(res, 404, 'not_found'); return;
        }
        file = indexFile;
        info = await stat(file);
      }
      const modified = info.mtime.toUTCString();
      const cached = file !== indexFile && req.headers['if-modified-since'];
      if (cached && Date.parse(cached) >= Date.parse(modified)) {
        res.writeHead(304, { 'last-modified': modified }); res.end(); return;
      }
      const ifRange = req.headers['if-range'];
      const rangeAllowed = !ifRange || (!ifRange.includes('"') && Date.parse(ifRange) === Date.parse(modified));
      const range = req.method === 'GET' && rangeAllowed ? byteRange(req.headers.range, info.size) : null;
      if (range === false) { send(res, 416, 'range_not_satisfiable', { 'content-range': `bytes */${info.size}` }); return; }
      const length = range ? range.end - range.start + 1 : info.size;
      const headers = {
        'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'content-length': length, 'accept-ranges': 'bytes', 'last-modified': modified,
        'cache-control': file === indexFile ? 'no-store'
          : pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
      };
      if (range) headers['content-range'] = `bytes ${range.start}-${range.end}/${info.size}`;
      res.writeHead(range ? 206 : 200, headers);
      if (req.method === 'HEAD' || info.size === 0) { res.end(); return; }
      pipeline(createReadStream(file, range ?? undefined), res, () => {});
    } catch {
      if (!res.headersSent) send(res, 500, 'static_unavailable'); else res.destroy();
    }
  });
  server.requestTimeout = 120_000;
  server.headersTimeout = 30_000;
  return server;
}
