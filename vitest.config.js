import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/setup.js'],
    exclude: ['**/node_modules/**', 'frontend/tests/dashboard.test.js'],
    fakeTimers: {
      // Use fake timers so retry delay tests don't take 3+ seconds
      toFake: ['setTimeout', 'clearTimeout'],
    },
    testTimeout: 10000,
  },
});
