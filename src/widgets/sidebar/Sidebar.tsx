import React, { useState, useEffect } from 'react';
import { SquarePen, History, Box, Plus, Search } from 'lucide-react';
import { useWorkspaceActions, useWorkspaceSelector } from '@/entities/workspace/useWorkspaceStore';
import { WorkspaceResourceList } from '@/features/session/ui/WorkspaceResourceList';
import { useI18n } from '@/shared/i18n';
import { usePresence } from '@/shared/ui/usePresence';
import { SidebarResourceContextMenu } from './SidebarResourceContextMenu';
import { useSidebarActions } from './useSidebarActions';
import { SidebarHeader } from './SidebarHeader';
import { SidebarFooter } from './SidebarFooter';
import { SessionHistoryList } from './SessionHistoryList';
import type { AgentController, AgentConversationView } from '@/features/agent-core/useAgentV2';
import './Sidebar.css';

interface SidebarProps {
  onOpenSettings?: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  agent?: AgentController;
  conversationView?: AgentConversationView;
  onConversationViewChange?: (view: AgentConversationView) => void;
  /** Whether the container capability is usable (false hides the containers section). */
  containerAvailable?: boolean;
}

export const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings, isMobileOpen, onCloseMobile, agent, conversationView = { kind: 'root' }, onConversationViewChange, containerAvailable = true }) => {
  const { t } = useI18n();
  const [_isCollapsed, setIsCollapsed] = useState(false);
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 900);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 900);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    if (!isMobile && isMobileOpen && onCloseMobile) {
      onCloseMobile();
      setIsCollapsed(true);
    }
  }, [isMobile, isMobileOpen, onCloseMobile]);

  const isCollapsed = isMobile ? false : _isCollapsed;
  const { presentValue: isMobileOverlayPresent, isExiting: isMobileOverlayExiting } = usePresence(isMobileOpen ? true : null, 240);

  const sessions = useWorkspaceSelector((state) => state.sessions);
  const containers = useWorkspaceSelector((state) => state.containers);
  const activeSessionId = useWorkspaceSelector((state) => state.activeSessionId);
  const activeContainerId = useWorkspaceSelector((state) => state.activeContainerId);
  const {
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
  } = useWorkspaceActions();

  const sortedSessions = [...sessions].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  const sortedContainers = [...containers].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

  const {
    contextMenu,
    contextResource,
    editing,
    setEditing,
    generatingTitleId,
    editInputRef,
    handleContextMenu,
    closeContextMenu,
    handleRenameSubmit,
    onRename,
    onGenerateTitle,
    onTogglePin,
    onDelete,
  } = useSidebarActions(
    sessions,
    containers,
    renameSession,
    renameContainer,
    deleteSession,
    deleteContainer,
    togglePinSession,
    togglePinContainer,
    t
  );

  return (
    <>
      {isMobileOverlayPresent && (
        <div className={`mobile-overlay motion-overlay-in ${isMobileOverlayExiting ? 'is-exiting' : ''}`} onClick={onCloseMobile} />
      )}
      <div className={`sidebar ${isCollapsed ? 'collapsed' : 'expanded'} ${isMobileOpen ? 'mobile-open' : ''}`}>
        
        <SidebarHeader 
          isCollapsed={isCollapsed} 
          setIsCollapsed={setIsCollapsed} 
          {...(onCloseMobile ? { onCloseMobile } : {})}
        />

        <div className="sidebar-content">
          {/* Actions */}
          <div className="sidebar-section">
            <button className="sidebar-action-btn" onClick={() => {
              createSession();
              if (containerAvailable && !activeContainerId) createContainer();
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

          {/* Containers Section */}
          {!isCollapsed && containerAvailable && (
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

          {/* History Section */}
          {!isCollapsed && (
            <div className="sidebar-section">
              <div className="sidebar-section-title">{t('sidebar.history')}</div>
              {agent && onConversationViewChange ? <SessionHistoryList sessions={sortedSessions} activeSessionId={activeSessionId} conversationView={conversationView} agent={agent} generatingId={generatingTitleId} editing={editing?.type === 'session' ? editing : null} editInputRef={editInputRef} emptyLabel={t('sidebar.noSessions')} deleteLabel={t('sidebar.delete')} onSelectSession={selectSession} onConversationViewChange={onConversationViewChange} onOpenSessionContext={(event, id) => handleContextMenu(event, 'session', id)} onEditChange={(_id, text) => setEditing((current) => current ? { ...current, text } : current)} onEditSubmit={handleRenameSubmit} /> : <WorkspaceResourceList items={sortedSessions} activeId={activeSessionId} isCollapsed={isCollapsed} emptyLabel={t('sidebar.noSessions')} generatingId={generatingTitleId} editing={editing?.type === 'session' ? editing : null} icon={History} onSelect={selectSession} onOpenContext={(event, id) => handleContextMenu(event, 'session', id)} onEditChange={(_id, text) => setEditing((current) => current ? { ...current, text } : current)} onEditSubmit={handleRenameSubmit} editInputRef={editInputRef} />}
            </div>
          )}
        </div>

        <SidebarFooter 
          isCollapsed={isCollapsed} 
          {...(onOpenSettings ? { onOpenSettings } : {})}
        />

      </div>

      <SidebarResourceContextMenu 
        menu={contextMenu} 
        {...(contextResource ? { resource: contextResource } : {})}
        dimmed={isMobile} 
        labels={{ rename: t('sidebar.rename'), generateTitle: t('sidebar.generateTitle'), pin: t('sidebar.pin'), unpin: t('sidebar.unpin'), delete: t('sidebar.delete') }} 
        onClose={closeContextMenu} 
        onRename={onRename} 
        onGenerateTitle={onGenerateTitle} 
        onTogglePin={onTogglePin} 
        onDelete={onDelete} 
      />
    </>
  );
};
