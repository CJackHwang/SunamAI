import React, { useState, useEffect, useRef } from 'react';
import { SquarePen, History, Box, Plus, PanelLeftClose, PanelLeft, Settings, Pin, Trash2, Edit2, Search, Sparkles } from 'lucide-react';
import { useWorkspaceStore } from '../../shared/store/useWorkspaceStore';
import { WorkspaceResourceList } from '@/features/session/ui/WorkspaceResourceList';
import { generateAutoTitle } from '@/features/session/titleService';
import { loadMessages } from '@/entities/message/repository';
import { readAppSettings } from '@/shared/lib/settings';
import { useI18n } from '@/shared/i18n';

interface SidebarProps {
  onOpenSettings?: () => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
}

type ContextMenuState = {
  type: 'session' | 'container';
  id: string;
  x: number;
  y: number;
} | null;

type EditingState = {
  type: 'session' | 'container';
  id: string;
  text: string;
} | null;

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

  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [editing, setEditing] = useState<EditingState>(null);
  const [generatingTitleId, setGeneratingTitleId] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

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

  const handleContextMenu = (e: React.MouseEvent, type: 'session' | 'container', id: string) => {
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

  const handleGenerateTitle = async (type: 'session' | 'container', id: string) => {
    closeContextMenu();
    const { apiKey, baseUrl, apiModel } = readAppSettings();

    if (!apiKey) {
      alert(t('sidebar.apiKeyRequired'));
      return;
    }
    setGeneratingTitleId(id);

    let input: string;
    if (type === 'session') {
      input = loadMessages(id).find((message) => message.role === 'user')?.content || '无有效对话记录，请随意发挥。';
    } else {
      input = '这是一个容器的自动重命名，请随意起名。';
    }

    try {
      const title = await generateAutoTitle(input, { apiKey, baseUrl, model: apiModel });
      if (title) {
        if (type === 'session') renameSession(id, title);
        else renameContainer(id, title);
      }
    } catch (error) {
      console.error(error);
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
        <div 
          className="mobile-overlay" 
          style={{ position: 'fixed', inset: 0, zIndex: 999, backgroundColor: 'rgba(0,0,0,0.5)' }} 
          onClick={onCloseMobile} 
        />
      )}
      <div className={`sidebar ${isCollapsed ? 'collapsed' : 'expanded'} ${isMobileOpen ? 'mobile-open' : ''}`}>
        {/* Header */}
        <div className="sidebar-header">
          <div 
            className={`sidebar-logo-toggle ${!isCollapsed ? 'expanded-mode' : ''}`}
            onClick={() => isCollapsed && setIsCollapsed(false)}
            title={isCollapsed ? "Expand Sidebar" : ""}
            style={{ cursor: isCollapsed ? 'pointer' : 'default', backgroundColor: 'transparent' }}
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
              <span className="sidebar-title" style={{ fontSize: '24px', fontWeight: 600, lineHeight: 1, letterSpacing: '-0.5px' }}>
                Sunam
              </span>
              <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
                <button 
                  className="sidebar-icon-btn"
                  title={t('sidebar.search')}
                  style={{ padding: '4px' }}
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
              <button className="sidebar-action-btn" title={t('sidebar.search')} style={{ marginTop: '8px' }}>
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
          <div className="sidebar-user" style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: isCollapsed ? 'center' : 'flex-start',
            gap: '12px', 
            overflow: 'hidden', 
            flex: isCollapsed ? 'none' : 1,
            width: isCollapsed ? '100%' : 'auto'
          }}>
            <img src="/head.jpeg" alt="Avatar" className="sidebar-avatar" />
            {!isCollapsed && <span className="sidebar-username">{t('sidebar.user')}</span>}
          </div>
          {!isCollapsed && (
            <button 
              className="sidebar-icon-btn" 
              onClick={onOpenSettings} 
              title={t('sidebar.settings')}
              style={{ padding: '6px', marginRight: '-4px' }}
            >
              <Settings size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <>
          <div className={`context-overlay ${isMobile ? 'dimmed' : ''}`} onClick={closeContextMenu} />
          <div 
            className="context-menu" 
            style={{ 
              position: 'fixed', 
              top: `${contextMenu.y}px`, 
              left: `${contextMenu.x}px`,
              zIndex: 1002 
            }}
          >
            <button 
              className="context-item" 
              onClick={() => {
                const isSession = contextMenu.type === 'session';
                const item = isSession 
                  ? sessions.find(s => s.id === contextMenu.id)
                  : containers.find(c => c.id === contextMenu.id);
                if (item) {
                  setEditing({ type: contextMenu.type, id: contextMenu.id, text: isSession ? (item as any).title : (item as any).name });
                }
                closeContextMenu();
              }}
            >
              <Edit2 size={16} className="context-item-icon" />
              {t('sidebar.rename')}
            </button>
            <button 
              className="context-item" 
              onClick={() => handleGenerateTitle(contextMenu.type, contextMenu.id)}
            >
              <Sparkles size={16} className="context-item-icon" />
              {t('sidebar.generateTitle')}
            </button>
            <button 
              className="context-item" 
              onClick={() => {
                if (contextMenu.type === 'session') togglePinSession(contextMenu.id);
                else togglePinContainer(contextMenu.id);
                closeContextMenu();
              }}
            >
              <Pin size={16} className="context-item-icon" />
              {(() => {
                const isSession = contextMenu.type === 'session';
                const item = isSession 
                  ? sessions.find(s => s.id === contextMenu.id)
                  : containers.find(c => c.id === contextMenu.id);
                return item?.pinned ? t('sidebar.unpin') : t('sidebar.pin');
              })()}
            </button>
            <div className="context-divider" />
            <button 
              className="context-item danger" 
              onClick={() => {
                const isSession = contextMenu.type === 'session';
                if (!isSession && !window.confirm(t('sidebar.confirmDeleteContainer'))) {
                  closeContextMenu();
                  return;
                }
                if (isSession) deleteSession(contextMenu.id);
                else deleteContainer(contextMenu.id);
                closeContextMenu();
              }}
            >
              <Trash2 size={16} className="context-item-icon" />
              {t('sidebar.delete')}
            </button>
          </div>
        </>
      )}
    </>
  );
};
