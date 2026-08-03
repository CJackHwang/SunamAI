import { useI18n } from '@/shared/i18n';
import './appNotice.css';

interface ContainerBootNoticeProps {
  message: string;
  onDismiss: () => void;
  onRetry?: () => void;
}

/**
 * Container boot-failure notice. Reuses the shared `app-notice-*` overlay/card styles
 * (same family as the app-update notice). The user is told once; dismissing continues in
 * chat-only mode. The container switch in the capability panel is the persistent retry path.
 */
export function ContainerBootNotice({ message, onDismiss, onRetry }: ContainerBootNoticeProps) {
  const { t } = useI18n();
  return (
    <div className="app-notice-overlay motion-fade-in" role="dialog" aria-modal="true">
      <div className="app-notice-card motion-rise-in">
        <div className="app-notice-content">
          <span className="app-notice-title">{t('containerNotice.title')}</span>
          <span className="app-notice-text">{t('containerNotice.body')}</span>
          {message ? <span className="app-notice-text app-notice-detail">{message}</span> : null}
        </div>
        <div className="app-notice-actions">
          {onRetry && (
            <button className="btn btn-primary" type="button" onClick={onRetry}>
              {t('containerNotice.retry')}
            </button>
          )}
          <button className="btn btn-secondary" type="button" onClick={onDismiss}>
            {t('containerNotice.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}
