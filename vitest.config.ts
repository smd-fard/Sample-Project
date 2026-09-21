import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    // No tests yet — don't fail the run until the first endpoint is implemented.
    passWithNoTests: true,
  },
});
