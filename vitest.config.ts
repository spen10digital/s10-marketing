import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/*/src/**/*.test.ts', 'apps/*/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'infra',
          include: ['infra/test/**/*.test.ts'],
          environment: 'node',
          // CDK synth with esbuild/asset staging is slow on Windows.
          testTimeout: 120_000,
        },
      },
      {
        test: {
          name: 'db',
          include: ['db/tests/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
  },
});
