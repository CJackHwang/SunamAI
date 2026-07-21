import type { RegisterSWOptions } from 'vite-plugin-pwa/types';

export function registerSW(_options?: RegisterSWOptions): (reloadPage?: boolean) => Promise<void> {
  return async () => undefined;
}
