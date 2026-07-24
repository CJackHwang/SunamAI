import React from 'react';
import { PanelLeft, PanelLeftClose, Search } from 'lucide-react';
import { useI18n } from '@/shared/i18n';

interface SidebarHeaderProps {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  onCloseMobile?: () => void;
}

export const SidebarHeader: React.FC<SidebarHeaderProps> = ({ isCollapsed, setIsCollapsed, onCloseMobile }) => {
  const { t } = useI18n();

  return (
    <div className="sidebar-header">
      <div 
        className={`sidebar-logo-toggle ${!isCollapsed ? 'expanded-mode' : 'is-collapsed'}`}
        onClick={() => isCollapsed && setIsCollapsed(false)}
        title={isCollapsed ? "Expand Sidebar" : ""}
      >
        <img src="/icon-nobg-svg.svg" alt="Sunam" className="logo-default" />
        {isCollapsed && (
          <div className="logo-hover">
            <PanelLeft size={20} />
          </div>
        )}
      </div>
      {!isCollapsed && (
        <>
          <span className="sidebar-title sidebar-brand">
            Sunam
          </span>
          <div className="sidebar-header-actions">
            <button 
              title={t('sidebar.search')}
              className="sidebar-icon-btn sidebar-header-search"
            >
              <Search size={18} />
            </button>
            <button 
              className="sidebar-toggle-btn desktop-only-btn"
              onClick={() => setIsCollapsed(true)}
              title={t('sidebar.collapse')}
            >
              <PanelLeftClose size={20} />
            </button>
            <button
              className="sidebar-toggle-btn mobile-sidebar-close"
              onClick={onCloseMobile}
              title={t('sidebar.close')}
              aria-label={t('sidebar.close')}
            >
              <PanelLeftClose size={20} />
            </button>
          </div>
        </>
      )}
    </div>
  );
};
