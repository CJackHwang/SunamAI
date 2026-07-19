import type { WebContainer } from '@webcontainer/api';
import { saveSnapshot } from './persistence';

/** Serializes persistence work so frequent filesystem changes cannot overlap snapshot writes. */
export function createSnapshotScheduler(webcontainer: WebContainer) {
  let running: Promise<void> | null = null;
  let queued = false;

  const flush = async () => {
    if (running) {
      queued = true;
      await running;
      return;
    }
    running = saveSnapshot(webcontainer).finally(() => { running = null; });
    await running;
    if (queued) {
      queued = false;
      await flush();
    }
  };

  return { flush, schedule: () => { void flush(); } };
}
