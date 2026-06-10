import { defineConfig } from 'vitest/config';

// Unit tests for the FSRS-6 engine, forward-simulation layer and IndexedDB
// migration, plus UI components, hooks, and state management. The forward-sim
// module is pure, so the default Node environment is sufficient for database
// tests; component tests rely on happy-dom for browser globals.
export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['./vitest.setup.ts'],
    fileParallelism: false,
  },
});
