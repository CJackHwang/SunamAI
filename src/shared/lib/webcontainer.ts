import { WebContainer } from '@webcontainer/api';
import { WEB_CONTAINER_WORKDIR_NAME } from './containerPaths';

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
      // This must match the COEP header applied by Vite/Vercel.
      const instance = await WebContainer.boot({
        workdirName: WEB_CONTAINER_WORKDIR_NAME,
        coep: 'credentialless',
      });

      // Patch WebContainer pnpm EACCES and symlink issues
      try {
        await instance.fs.mkdir('/home/webcontainer', { recursive: true });
        // Force pnpm to use hoisted node-linker to prevent symlink permission drops (WebContainer optimal solution)
        await instance.fs.writeFile('/home/webcontainer/.npmrc', 'node-linker=hoisted\n');
      } catch {
        // ignore initialization errors
      }

      webcontainerInstance = instance;
      return instance;
    } catch (error) {
      bootPromise = null;
      throw error;
    }
  })();

  return bootPromise;
};

export const resetWebContainer = async (): Promise<void> => {
  const instance = webcontainerInstance ?? await bootPromise;
  if (!instance) {
    bootPromise = null;
    return;
  }
  webcontainerInstance = null;
  bootPromise = null;
  await instance.teardown();
};
