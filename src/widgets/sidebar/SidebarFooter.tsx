import React from 'react';
import { Settings } from 'lucide-react';
import { useI18n } from '@/shared/i18n';

interface SidebarFooterProps {
  isCollapsed: boolean;
  onOpenSettings?: () => void;
}

export const SidebarFooter: React.FC<SidebarFooterProps> = ({ isCollapsed, onOpenSettings }) => {
  const { t } = useI18n();

  return (
    <div className="sidebar-footer">
      <div className="sidebar-user">
        <img src="/head.jpeg" alt="Avatar" className="sidebar-avatar" />
        {!isCollapsed && <span className="sidebar-username">{t('sidebar.user')}</span>}
      </div>
      {!isCollapsed && (
        <button
          className="sidebar-icon-btn sidebar-settings"
          onClick={onOpenSettings}
          title={t('sidebar.settings')}
        >
          <Settings size={18} />
        </button>
      )}
    </div>
  );
};
