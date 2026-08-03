import { useState, useSyncExternalStore } from 'react';
import { useI18n } from '@/shared/i18n';
import { getAppUpdateSnapshot, reloadToApplyUpdate, subscribeToAppUpdate } from '@/shared/lib/appUpdates';
import './appNotice.css';

export function AppUpdateNotice() {
  const { t } = useI18n();
  const storeUpdate = useSyncExternalStore(subscribeToAppUpdate, getAppUpdateSnapshot, () => false);
  const isTest = import.meta.env.DEV && new URLSearchParams(window.location.search).has('test-update');
  const [dismissed, setDismissed] = useState(false);
  const updateAvailable = (storeUpdate || isTest) && !dismissed;

  if (!updateAvailable) return null;

  return (
    <div className="app-notice-overlay motion-fade-in" role="dialog" aria-modal="true">
      <div className="app-notice-card motion-rise-in">
        <div className="app-notice-content">
          <span className="app-notice-text">{t('update.available')}</span>
        </div>
        <div className="app-notice-actions">
          <button className="btn btn-primary" type="button" onClick={() => { void reloadToApplyUpdate(); }}>
            {t('update.reload')}
          </button>
          <button className="btn btn-secondary" type="button" onClick={() => setDismissed(true)}>
            {t('update.later')}
          </button>
        </div>
      </div>
    </div>
  );
}
