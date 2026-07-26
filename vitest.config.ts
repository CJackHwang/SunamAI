import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'virtual:pwa-register': fileURLToPath(new URL('./tests/mocks/pwaRegister.ts', import.meta.url)),
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
        'src/shared/lib/{storage,settings}.ts',
        'src/shared/lib/containerPaths.ts',
        'src/shared/lib/tokenEstimate.ts',
        'src/shared/api/{llm,sse,models}.ts',
        'src/entities/workspace/{repository,store,sessionStore,containerStore}.ts',
        'src/entities/persistence/v3*.ts',
        'src/features/agent-core/**/*.ts',
        'src/features/runtime/{WebContainerAgentRuntime,processRegistry,snapshotCoordinator,snapshotScheduler,workspaceFileSystem}.ts',
        'src/features/file-manager/fileUtils.ts',
      ],
      exclude: ['**/*.d.ts', '**/*.tsx', 'src/features/agent-core/useAgentV2.ts'],
      thresholds: {
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
  },
});
