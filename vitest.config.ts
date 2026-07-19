import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 10_000,
    include: ['tests/{unit,component}/**/*.{test,spec}.{ts,tsx}'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'src/shared/lib/{storage,settings,async}.ts',
        'src/shared/lib/containerPaths.ts',
        'src/shared/persistence/{v2Repository,snapshotScheduler}.ts',
        'src/shared/store/useWorkspaceStore.ts',
        'src/shared/api/{llm,sse,models}.ts',
        'src/entities/workspace/repository.ts',
        'src/features/agent-core/{engine,eventStore,events,projector,tools}.ts',
        'src/features/terminal-session/WebContainerAgentRuntime.ts',
        'src/features/file-manager/fileUtils.ts',
      ],
      exclude: ['**/*.d.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
