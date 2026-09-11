import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createShowcaseServer } from './http-server.mjs';

function portValue(value, name) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${name} must be a valid TCP port`);
  return port;
}

for (const name of ['DATABASE_URL', 'PLAYERONE_TOKEN_SECRET']) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
const port = portValue(process.env.PORT ?? '3000', 'PORT');
const apiPort = portValue(process.env.PLAYERONE_API_PORT ?? (port === 8081 ? '8082' : '8081'), 'PLAYERONE_API_PORT');
if (port === apiPort) throw new Error('PORT and PLAYERONE_API_PORT must be different');
const root = fileURLToPath(new URL('../', import.meta.url));
const secure = process.env.PLAYERONE_SECURE_COOKIES === '1';
if (secure && !process.env.PLAYERONE_PROXY_MODE) {
  throw new Error('PLAYERONE_PROXY_MODE must explicitly select the trusted ingress for an HTTPS deployment');
}
const server = await createShowcaseServer({
  distDir: fileURLToPath(new URL('../apps/console/dist/', import.meta.url)), apiPort,
  secure, proxyMode: process.env.PLAYERONE_PROXY_MODE ?? 'direct',
});
const child = spawn(process.execPath, ['packages/api/bin/serve.ts'], {
  cwd: root, stdio: 'inherit', shell: false,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(apiPort), PLAYERONE_TRUST_LOOPBACK_PROXY: '1' },
});

let stopping = false;
function stop(code, signal) {
  if (stopping) return;
  stopping = true;
  console.log(`${signal}: stopping showcase`);
  const deadline = setTimeout(() => {
    server.closeAllConnections();
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    process.exit(code);
  }, 10_000);
  const closed = new Promise((done) => server.close(() => done()));
  const exited = new Promise((done) => {
    if (child.exitCode !== null || child.signalCode !== null) { done(); return; }
    child.once('exit', done);
    child.once('error', done);
    child.kill('SIGTERM');
  });
  Promise.all([closed, exited]).then(() => { clearTimeout(deadline); process.exit(code); });
}
child.once('error', () => stop(1, 'API startup failed'));
child.once('exit', (code) => { if (!stopping) stop(code || 1, 'API exited'); });
server.once('error', () => stop(1, 'HTTP startup failed'));
process.once('SIGTERM', () => stop(0, 'SIGTERM'));
process.once('SIGINT', () => stop(0, 'SIGINT'));
server.listen(port, '0.0.0.0', () => console.log(`playerone showcase listening on :${port}`));
