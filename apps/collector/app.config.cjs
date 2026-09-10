const { existsSync } = require('node:fs');
const { isAbsolute } = require('node:path');
const { withAppBuildGradle } = require('expo/config-plugins');

// Native release settings. Secrets are read by Gradle, never embedded in Expo config.
module.exports = ({ config }) => {
  const profile = process.env.PLAYERONE_BUILD_PROFILE || 'development';
  if (!['development', 'demo', 'play'].includes(profile)) throw new Error('Unknown PLAYERONE_BUILD_PROFILE');
  if (profile === 'development') return config;
  const raw = process.env.EXPO_PUBLIC_API_URL;
  if (!raw) throw new Error('EXPO_PUBLIC_API_URL is required for an installable build');
  let url;
  try { url = new URL(raw); } catch { throw new Error('EXPO_PUBLIC_API_URL must be an absolute HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/' || raw !== url.origin) {
    throw new Error('EXPO_PUBLIC_API_URL must be an HTTP(S) origin without credentials, path, query or fragment');
  }
  if (process.env.EXPO_PUBLIC_MOCK_API === '1' || process.env.PLAYERONE_MOCK_API === '1') {
    throw new Error('Installable builds must use the real API');
  }
  if (profile === 'play' && (url.protocol !== 'https:' || !url.hostname.includes('.') || /^(localhost|0\.|127\.|169\.254\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[)/i.test(url.hostname) || /\.(local|localhost|invalid|test)$/i.test(url.hostname))) {
    throw new Error('Play builds require a public HTTPS API origin');
  }
  const version = process.env.PLAYERONE_VERSION_CODE;
  if (!version || !/^[1-9]\d*$/.test(version) || Number(version) > 2100000000) {
    throw new Error('PLAYERONE_VERSION_CODE must be a positive integer at most 2100000000');
  }
  const play = profile === 'play';
  const next = {
    ...config,
    name: play ? config.name : `${config.name} Demo`,
    android: { ...config.android, package: `${config.android.package}${play ? '' : '.demo'}`, versionCode: Number(version) },
    plugins: (config.plugins || []).map((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-build-properties'
      ? [plugin[0], { ...plugin[1], android: { ...plugin[1]?.android, targetSdkVersion: 36, usesCleartextTraffic: !play } }]
      : plugin),
  };
  if (!play) return next;
  for (const key of ['PLAYERONE_UPLOAD_KEYSTORE', 'PLAYERONE_UPLOAD_STORE_PASSWORD', 'PLAYERONE_UPLOAD_KEY_ALIAS', 'PLAYERONE_UPLOAD_KEY_PASSWORD']) {
    if (!process.env[key]) throw new Error(`${key} is required for Play signing`);
  }
  if (!isAbsolute(process.env.PLAYERONE_UPLOAD_KEYSTORE) || !existsSync(process.env.PLAYERONE_UPLOAD_KEYSTORE)) {
    throw new Error('PLAYERONE_UPLOAD_KEYSTORE must name an existing absolute file path');
  }
  return withAppBuildGradle(next, (mod) => {
    if (mod.modResults.language !== 'groovy') throw new Error('Review the Play signing plugin for this Gradle format');
    const marker = '// PlayerOne upload signing';
    if (mod.modResults.contents.includes(marker)) throw new Error('Regenerate Android before changing signing profiles');
    mod.modResults.contents += `\n${marker}
android {
    signingConfigs {
        playeroneUpload {
            storeFile file(System.getenv('PLAYERONE_UPLOAD_KEYSTORE'))
            storePassword System.getenv('PLAYERONE_UPLOAD_STORE_PASSWORD')
            keyAlias System.getenv('PLAYERONE_UPLOAD_KEY_ALIAS')
            keyPassword System.getenv('PLAYERONE_UPLOAD_KEY_PASSWORD')
        }
    }
    buildTypes.release.signingConfig = signingConfigs.playeroneUpload
}
`;
    return mod;
  });
};
