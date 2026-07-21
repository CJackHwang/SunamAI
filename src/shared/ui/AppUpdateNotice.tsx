import { useSyncExternalStore } from 'react';
import { useI18n } from '@/shared/i18n';
import { getAppUpdateSnapshot, reloadToApplyUpdate, subscribeToAppUpdate } from '@/shared/lib/appUpdates';
import './AppUpdateNotice.css';

export function AppUpdateNotice() {
  const { t } = useI18n();
  const updateAvailable = useSyncExternalStore(subscribeToAppUpdate, getAppUpdateSnapshot, () => false);

  if (!updateAvailable) return null;

  return (
    <div className="app-update-notice motion-rise-in" role="status">
      <span>{t('update.available')}</span>
      <button className="btn btn-secondary" type="button" onClick={() => { void reloadToApplyUpdate(); }}>
        {t('update.reload')}
      </button>
    </div>
  );
}
