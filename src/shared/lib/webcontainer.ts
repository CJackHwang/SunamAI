import { WebContainer } from '@webcontainer/api';
import { loadSnapshot } from './persistence.ts';

let webcontainerInstance: WebContainer | null = null;
let bootPromise: Promise<WebContainer> | null = null;

export const getWebContainer = async (): Promise<WebContainer> => {
  if (webcontainerInstance) {
    return webcontainerInstance;
  }

  if (bootPromise) {
    return bootPromise;
  }

  bootPromise = (async () => {
    try {
      console.log('Booting WebContainer...');
      // This must match the COEP header applied by Vite/Vercel.
      const instance = await WebContainer.boot({
        workdirName: 'sunam',
        coep: 'credentialless',
      });
      webcontainerInstance = instance;
      console.log('WebContainer booted successfully.');

      // Restore filesystem from IndexedDB snapshot if one exists
      const snapshotData = await loadSnapshot();
      if (snapshotData) {
        console.log('Restoring filesystem from snapshot...');
        await instance.mount(snapshotData);
        console.log('Filesystem restored.');
      }

      return instance;
    } catch (error) {
      console.error('Failed to boot WebContainer:', error);
      bootPromise = null;
      throw error;
    }
  })();

  return bootPromise;
};
