import { useSyncExternalStore } from 'react';
import { useI18n } from '@/shared/i18n';
import { getAppUpdateSnapshot, reloadToApplyUpdate, subscribeToAppUpdate } from '@/shared/lib/appUpdates';
import './AppUpdateNotice.css';

export function AppUpdateNotice() {
  const { t } = useI18n();
  const storeUpdate = useSyncExternalStore(subscribeToAppUpdate, getAppUpdateSnapshot, () => false);
  const isTest = import.meta.env.DEV && new URLSearchParams(window.location.search).has('test-update');
  const updateAvailable = storeUpdate || isTest;

  if (!updateAvailable) return null;

  return (
    <div className="app-update-overlay motion-fade-in" role="dialog" aria-modal="true">
      <div className="app-update-notice motion-rise-in">
        <div className="app-update-content">
          <span className="app-update-text">{t('update.available')}</span>
        </div>
        <button className="btn btn-primary" type="button" onClick={() => { void reloadToApplyUpdate(); }}>
          {t('update.reload')}
        </button>
      </div>
    </div>
  );
}
