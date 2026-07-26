import { registerSW } from 'virtual:pwa-register';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const MIN_CHECK_GAP_MS = 60 * 1000;

type UpdateListener = () => void;

const listeners = new Set<UpdateListener>();
let initialized = false;
let updateAvailable = false;
let applyUpdate: ((reloadPage?: boolean) => Promise<void>) | null = null;

function publishUpdate() {
  if (updateAvailable) return;
  updateAvailable = true;
  listeners.forEach((listener) => listener());
}

export function initializeAppUpdates() {
  if (initialized || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  initialized = true;

  applyUpdate = registerSW({
    immediate: true,
    onNeedRefresh: publishUpdate,
    onRegisteredSW(_serviceWorkerUrl, registration) {
      if (!registration) return;

      let lastCheckedAt = 0;
      const checkForUpdate = () => {
        const now = Date.now();
        if (document.visibilityState !== 'visible' || !navigator.onLine || now - lastCheckedAt < MIN_CHECK_GAP_MS) return;
        lastCheckedAt = now;
        void registration.update().catch((error: unknown) => {
          console.warn('Unable to check for an app update.', error);
        });
      };

      document.addEventListener('visibilitychange', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
      window.setInterval(checkForUpdate, CHECK_INTERVAL_MS);
    },
    onRegisterError(error) {
      console.warn('Unable to register the app service worker.', error);
    },
  });
}

export function subscribeToAppUpdate(listener: UpdateListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getAppUpdateSnapshot() {
  return updateAvailable;
}

export async function reloadToApplyUpdate() {
  if (!applyUpdate) return;
  try {
    await applyUpdate(true);
  } catch (error) {
    console.warn('Unable to apply the app update.', error);
  }
}
