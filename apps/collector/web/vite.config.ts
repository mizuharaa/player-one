import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The browser harness's build. Five aliases and a handful of defines; nothing else.
 *
 * - `react-native` → `react-native-web`, which is the whole trick.
 * - `expo-secure-store` → a stub, because it is a native module and the two
 *   files that touch it (`api/token-store.ts`, `guide/seen.ts`) are imported
 *   from `App.tsx` at module load. The stub is `web/stubs/expo-secure-store.ts`
 *   and is memory-only, which is correct here: a harness has no keystore and
 *   should not pretend to remember anything between reloads.
 * - `expo-file-system` → a stub, for the same reason: `upload/delivery-native.ts`
 *   is imported from the uploads screen at module load and there is no Storage
 *   Access Framework in a browser. Every entry point throws rather than
 *   inventing a session directory.
 * - `expo-video` -> a stub, and the one stub here that is not a thrower: a
 *   browser has video, so it is the same `<video>` element the console's
 *   `/discover` plays, behind the surface the phone's `<VideoView>` offers.
 * - `.ts`/`.tsx` extensions resolve, because this project imports its own files
 *   with the extension on (`allowImportingTsExtensions`) and esbuild needs to
 *   be told that is fine.
 *
 * `EXPO_PUBLIC_MOCK_API` is defined to `'1'` so `api/config.ts` selects
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
      'expo-file-system': here('./stubs/expo-file-system.ts'),
      'expo-video': here('./stubs/expo-video.tsx'),
    },
    extensions: ['.web.tsx', '.web.ts', '.tsx', '.ts', '.jsx', '.js', '.json'],
  },
  define: {
    'process.env.EXPO_PUBLIC_MOCK_API': JSON.stringify('1'),
    'process.env.EXPO_PUBLIC_API_URL': JSON.stringify(''),
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
