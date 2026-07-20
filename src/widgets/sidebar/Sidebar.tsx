import React, { useState, useEffect, useRef } from 'react';
import { SquarePen, History, Box, Plus, PanelLeftClose, PanelLeft, Settings, Search } from 'lucide-react';
import { useWorkspaceStore } from '@/entities/workspace/store';
import { WorkspaceResourceList } from '@/features/session/ui/WorkspaceResourceList';
import { generateAutoTitle } from '@/features/session/titleService';
import { AgentEventStore } from '@/features/agent-core/eventStore';
import { projectMessages } from '@/features/agent-core/projector';
import { readAppSettings } from '@/shared/lib/settings';
import { useI18n } from '@/shared/i18n';
import { SidebarResourceContextMenu } from './SidebarResourceContextMenu';
import { findSidebarResource, sidebarResourceLabel, type SidebarContextMenuState, type SidebarEditingState, type SidebarResourceKind } from './sidebarResources';
import './Sidebar.css';

interface SidebarProps {
  onOpenSettings?: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings, isMobileOpen, onCloseMobile }) => {
  const { t } = useI18n();
  const [_isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 900);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isCollapsed = isMobile ? false : _isCollapsed;

  const [contextMenu, setContextMenu] = useState<SidebarContextMenuState | null>(null);
  const [editing, setEditing] = useState<SidebarEditingState | null>(null);
  const [generatingTitleId, setGeneratingTitleId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const eventStoreRef = useRef(new AgentEventStore());

  const {
    sessions,
    containers,
    activeSessionId,
    activeContainerId,
    createSession,
    renameSession,
    deleteSession,
    togglePinSession,
    selectSession,
    createContainer,
    renameContainer,
    deleteContainer,
    togglePinContainer,
    selectContainer
  } = useWorkspaceStore();

  const sortedSessions = [...sessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const sortedContainers = [...containers].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const contextResource = contextMenu ? findSidebarResource(contextMenu.type, contextMenu.id, sessions, containers) : undefined;

  const handleContextMenu = (e: React.MouseEvent, type: SidebarResourceKind, id: string) => {
    e.preventDefault();
    setContextMenu({ type, id, x: e.clientX, y: e.clientY });
  };

  const closeContextMenu = () => setContextMenu(null);

  const handleRenameSubmit = () => {
    if (!editing || !editing.text.trim()) {
      setEditing(null);
      return;
    }
    if (editing.type === 'session') {
      renameSession(editing.id, editing.text.trim());
    } else {
      renameContainer(editing.id, editing.text.trim());
    }
    setEditing(null);
  };

  const handleGenerateTitle = async (type: SidebarResourceKind, id: string) => {
    closeContextMenu();
    const { apiKey, baseUrl, apiModel } = readAppSettings();

    if (!apiKey) {
      alert(t('sidebar.apiKeyRequired'));
      return;
    }
    setGeneratingTitleId(id);

    try {
      let input: string;
      if (type === 'session') {
        const events = await eventStoreRef.current.loadSessionEvents(id);
        input = projectMessages(events).find((message) => message.role === 'user')?.content || '无有效对话记录，请随意发挥。';
      } else {
        input = '这是一个容器的自动重命名，请随意起名。';
      }
      const title = await generateAutoTitle(input, { apiKey, baseUrl, model: apiModel });
      if (title) {
        if (type === 'session') renameSession(id, title);
        else renameContainer(id, title);
      }
    } catch {
      alert(t('sidebar.renameFailed'));
    } finally {
      setGeneratingTitleId(null);
    }
  };

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editing]);

  return (
    <>
      {isMobileOpen && (
        <div className="mobile-overlay motion-overlay-in" onClick={onCloseMobile} />
      )}
      <div className={`sidebar ${isCollapsed ? 'collapsed' : 'expanded'} ${isMobileOpen ? 'mobile-open' : ''}`}>
        {/* Header */}
        <div className="sidebar-header">
          <div 
            className={`sidebar-logo-toggle ${!isCollapsed ? 'expanded-mode' : 'is-collapsed'}`}
            onClick={() => isCollapsed && setIsCollapsed(false)}
            title={isCollapsed ? "Expand Sidebar" : ""}
          >
            <img src="/icon.png" alt="Sunam" className="logo-default" />
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

        <div className="sidebar-content">
          {/* Actions */}
          <div className="sidebar-section">
            <button className="sidebar-action-btn" onClick={() => {
              createSession();
              if (!activeContainerId) createContainer();
            }}>
              <SquarePen size={18} />
              {!isCollapsed && <span>{t('sidebar.newTask')}</span>}
            </button>
            
            {isCollapsed && (
              <button className="sidebar-action-btn sidebar-collapsed-search" title={t('sidebar.search')}>
                <Search size={18} />
              </button>
            )}
          </div>

          {/* Containers Section (Moved Up) */}
          {!isCollapsed && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">
                {t('sidebar.containers')}
                <button className="sidebar-icon-btn" onClick={() => { if (window.confirm(t('sidebar.confirmNewContainer'))) createContainer(); }} title={t('sidebar.newContainer')}>
                  <Plus size={14} />
                </button>
              </div>
              <WorkspaceResourceList items={sortedContainers} activeId={activeContainerId} isCollapsed={isCollapsed} emptyLabel={t('sidebar.noContainers')} generatingId={generatingTitleId} editing={editing?.type === 'container' ? editing : null} icon={Box} onSelect={selectContainer} onOpenContext={(event, id) => handleContextMenu(event, 'container', id)} onEditChange={(_id, text) => setEditing((current) => current ? { ...current, text } : current)} onEditSubmit={handleRenameSubmit} editInputRef={editInputRef} />
            </div>
          )}

          {/* History Section (Renamed to 历史对话, hidden when collapsed) */}
          {!isCollapsed && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">{t('sidebar.history')}</div>
              <WorkspaceResourceList items={sortedSessions} activeId={activeSessionId} isCollapsed={isCollapsed} emptyLabel={t('sidebar.noSessions')} generatingId={generatingTitleId} editing={editing?.type === 'session' ? editing : null} icon={History} onSelect={selectSession} onOpenContext={(event, id) => handleContextMenu(event, 'session', id)} onEditChange={(_id, text) => setEditing((current) => current ? { ...current, text } : current)} onEditSubmit={handleRenameSubmit} editInputRef={editInputRef} />
            </div>
          )}
        </div>

        {/* Footer */}
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
      </div>

      {/* Context Menu */}
      {contextMenu && <SidebarResourceContextMenu menu={contextMenu} resource={contextResource} dimmed={isMobile} labels={{ rename: t('sidebar.rename'), generateTitle: t('sidebar.generateTitle'), pin: t('sidebar.pin'), unpin: t('sidebar.unpin'), delete: t('sidebar.delete') }} onClose={closeContextMenu} onRename={() => { if (contextResource) setEditing({ type: contextMenu.type, id: contextMenu.id, text: sidebarResourceLabel(contextResource) }); closeContextMenu(); }} onGenerateTitle={() => { void handleGenerateTitle(contextMenu.type, contextMenu.id); }} onTogglePin={() => { if (contextMenu.type === 'session') togglePinSession(contextMenu.id); else togglePinContainer(contextMenu.id); closeContextMenu(); }} onDelete={() => { const session = contextMenu.type === 'session'; if (!session && !window.confirm(t('sidebar.confirmDeleteContainer'))) { closeContextMenu(); return; } if (session) deleteSession(contextMenu.id); else deleteContainer(contextMenu.id); closeContextMenu(); }} />}
    </>
  );
};
