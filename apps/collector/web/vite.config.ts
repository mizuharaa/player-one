import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The browser harness's build. Three aliases and one define; nothing else.
 *
 * - `react-native` → `react-native-web`, which is the whole trick.
 * - `expo-secure-store` → a stub, because it is a native module and the two
 *   files that touch it (`api/token-store.ts`, `guide/seen.ts`) are imported
 *   from `App.tsx` at module load. The stub is `web/stubs/expo-secure-store.ts`
 *   and is memory-only, which is correct here: a harness has no keystore and
 *   should not pretend to remember anything between reloads.
 * - `.ts`/`.tsx` extensions resolve, because this project imports its own files
 *   with the extension on (`allowImportingTsExtensions`) and esbuild needs to
 *   be told that is fine.
 *
 * `PLAYERONE_MOCK_API` is defined to `'1'` so `api/config.ts` selects
 * `MockCollectorApi`. The harness never talks to the platform.
 */
const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here('.'),
  plugins: [react()],
  resolve: {
    alias: {
      'react-native': 'react-native-web',
      'expo-secure-store': here('./stubs/expo-secure-store.ts'),
    },
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.json'],
  },
  define: {
    'process.env.PLAYERONE_MOCK_API': JSON.stringify('1'),
    'process.env.PLAYERONE_API_URL': JSON.stringify(''),
    // The real film, served out of `web/public/`. On a phone this stays unset
    // and the landing renders the poster frame instead — there is no <Video>
    // in React Native core (DEVICE_DEPS.md).
    'process.env.LANDING_VIDEO_URL': JSON.stringify('/landing.mp4'),
    'process.env.LANDING_CENTRE_CODE': JSON.stringify(''),
    __DEV__: 'true',
    // react-native-web's Animated internals reach for the React Native global.
    // Vite targets the browser, where it is `globalThis`.
    global: 'globalThis',
  },
  optimizeDeps: {
    esbuildOptions: { resolveExtensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.js'] },
  },
  server: { port: 5177, strictPort: true },
});
