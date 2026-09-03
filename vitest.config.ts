import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Agent worktrees live under `.claude/worktrees/` inside this checkout while
 * they run; each is a full copy of the tree. Without this vitest collects their
 * test files too and every count doubles.
 */
export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, '.claude/**'],
    /**
     * Every database test file creates and migrates its own throwaway database
     * in a `beforeAll`, and vitest runs those files in parallel. On a slow CI
     * runner that hook has been measured past vitest's 10 s default: one run of
     * commit 3c306c3 passed in 4m33s and the other run of the same commit
     * failed three files on "Hook timed out in 10000ms" at 12m44s. The hook is
     * measuring the runner, not the code. CLAUDE.md already documents the
     * suite's invocation as `--hookTimeout=180000`; this makes `pnpm test` and
     * a bare `vitest run` agree with it.
     */
    hookTimeout: 180_000,
  },
});
