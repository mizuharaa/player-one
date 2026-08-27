import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Agent worktrees live under `.claude/worktrees/` inside this checkout while
 * they run; each is a full copy of the tree. Without this vitest collects their
 * test files too and every count doubles.
 */
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, '.claude/**'] },
});
