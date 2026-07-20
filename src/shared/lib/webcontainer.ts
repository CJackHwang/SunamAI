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
      webcontainerInstance = instance;
      return instance;
    } catch (error) {
      bootPromise = null;
      throw error;
    }
  })();

  return bootPromise;
};
