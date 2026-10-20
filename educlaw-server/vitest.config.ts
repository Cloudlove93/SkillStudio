import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Route tests call `vi.resetModules()` in hooks, which re-imports the whole
    // express + service module graph. Alone that takes ~2.4s; under a full
    // parallel run it can exceed the 5s default and fail as a timeout instead
    // of a real regression. Keep the suite green without hiding assertion
    // failures by giving hooks and tests a wider budget.
    testTimeout: 20_000,
    hookTimeout: 20_000,
  },
});
