import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';

/**
 * The console's build.
 *
 * Two things here are constraints rather than convenience:
 *
 * **Everything is bundled, nothing is fetched.** Fonts arrive through
 * `@fontsource-variable/*` from `node_modules` and end up in `dist/assets`.
 * An upload centre sits on a LAN with the link down; a stylesheet or a webfont
 * pulled from a CDN at runtime would make the console's typography depend on
 * the internet being up, which is the dependency the rest of the service
 * refuses. `assetsInlineLimit: 0` keeps the woff2 files as real files so the
 * browser can cache them across deploys instead of re-parsing them out of CSS.
 *
 * **The dev proxy carries cookies.** Sessions are `HttpOnly` + `SameSite=Strict`
 * (see `packages/api/src/cookies.ts`), so the browser only sends them to the
 * origin that set them. Proxying the API through Vite's own origin in
 * development is what makes a signed-in dev session work at all — pointing the
 * client at `http://localhost:8080` directly would silently drop every cookie
 * and present as an endless redirect back to sign-in.
 */
export default defineConfig({
  plugins: [react(), tailwind()],
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: Object.fromEntries(
      ['/api', '/auth', '/media', '/whoami', '/reference'].map((path) => [
        path,
        {
          target: process.env['PLAYERONE_API'] ?? 'http://127.0.0.1:8080',
          changeOrigin: false,
        },
      ]),
    ),
  },
});
