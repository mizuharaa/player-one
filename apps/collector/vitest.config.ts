import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { 'react-native-reanimated': fileURLToPath(new URL('./test/reanimated.tsx', import.meta.url)) } },
  test: { include: ['test/**/*.test.{ts,tsx}'], maxWorkers: 4, minWorkers: 1 },
});
