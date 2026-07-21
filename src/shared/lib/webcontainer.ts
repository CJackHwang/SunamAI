import { WebContainer } from '@webcontainer/api';

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
        workdirName: 'sunam',
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
