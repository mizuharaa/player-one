import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const profile = process.argv[2];
if (!['demo', 'play'].includes(profile)) throw new Error('Choose demo (APK) or play (AAB)');
const root = fileURLToPath(new URL('../', import.meta.url));
process.env.PLAYERONE_BUILD_PROFILE = profile;
const configure = require('../app.config.cjs');
configure({ config: require('../app.json').expo }); // Fail before cleaning or building native files.
if (profile === 'play') {
  const cert = spawnSync('keytool', ['-J-Duser.language=en', '-list', '-v', '-keystore', process.env.PLAYERONE_UPLOAD_KEYSTORE,
    '-alias', process.env.PLAYERONE_UPLOAD_KEY_ALIAS, '-storepass:env', 'PLAYERONE_UPLOAD_STORE_PASSWORD'],
  { env: process.env, encoding: 'utf8', windowsHide: true });
  if (cert.error || cert.status !== 0 || !cert.stdout.includes('PrivateKeyEntry')) throw new Error('Cannot verify the configured upload signing key');
  if (/CN\s*=\s*Android Debug/i.test(cert.stdout)) throw new Error('The Android debug key cannot sign a Play release');
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, env: process.env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run(process.execPath, [require.resolve('expo/bin/cli'), 'prebuild', '--platform', 'android', '--clean', '--no-install'], root);
const task = profile === 'play' ? 'bundleRelease' : 'assembleRelease';
const android = fileURLToPath(new URL('../android/', import.meta.url));
if (process.platform === 'win32') run('cmd.exe', ['/d', '/c', 'gradlew.bat', task], android);
else run('./gradlew', [task], android);
console.log(`${profile} build complete. Verify the artifact signature and test it on a handset before distribution.`);
