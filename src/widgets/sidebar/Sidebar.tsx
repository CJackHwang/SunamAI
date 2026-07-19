import React, { useState, useEffect, useRef } from 'react';
import { SquarePen, History, Box, Plus, PanelLeftClose, PanelLeft, MoreHorizontal, Settings, Pin, Trash2, Edit2, Search } from 'lucide-react';
import { useWorkspaceStore } from '../../shared/store/useWorkspaceStore';

interface SidebarProps {
  onOpenSettings?: () => void;
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

export const Sidebar: React.FC<SidebarProps> = ({ onOpenSettings }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [editing, setEditing] = useState<EditingState>(null);
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

  useEffect(() => {
    if (editing && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editing]);

  return (
    <div className={`sidebar ${isCollapsed ? 'collapsed' : 'expanded'}`}>
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
            <span className="sidebar-title" style={{ fontSize: '24px', fontWeight: 600, lineHeight: 1, letterSpacing: '-0.5px', transform: 'translateY(-2px)' }}>
              Sunam
            </span>
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <button 
                className="sidebar-icon-btn"
                title="搜索历史对话"
                style={{ padding: '4px' }}
              >
                <Search size={18} />
              </button>
              <button 
                className="sidebar-toggle-btn"
                onClick={() => setIsCollapsed(true)}
                title="Collapse Sidebar"
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
          <button className="sidebar-action-btn" onClick={createSession}>
            <SquarePen size={18} />
            {!isCollapsed && <span>新建任务</span>}
          </button>
          
          {isCollapsed && (
            <button className="sidebar-action-btn" title="搜索历史对话" style={{ marginTop: '8px' }}>
              <Search size={18} />
            </button>
          )}
        </div>

        {/* Containers Section (Moved Up) */}
        {!isCollapsed && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">
              容器
              <button className="sidebar-icon-btn" onClick={createContainer} title="新建容器">
                <Plus size={14} />
              </button>
            </div>
            <div className="sidebar-list">
              {sortedContainers.map(container => (
                <div 
                  key={container.id} 
                  className={`sidebar-item ${activeContainerId === container.id ? 'active' : ''}`}
                  onClick={() => selectContainer(container.id)}
                  onContextMenu={(e) => handleContextMenu(e, 'container', container.id)}
                >
                  <Box size={16} style={{ color: container.pinned ? 'var(--color-black)' : 'inherit' }} />
                  {editing?.id === container.id ? (
                    <input 
                      ref={editInputRef}
                      className="item-text"
                      style={{ border: 'none', background: 'transparent', outline: 'none', font: 'inherit', padding: 0 }}
                      value={editing.text}
                      onChange={e => setEditing({ ...editing, text: e.target.value })}
                      onBlur={handleRenameSubmit}
                      onKeyDown={e => e.key === 'Enter' && handleRenameSubmit()}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="item-text">{container.name}</span>
                  )}
                  <button 
                    className="item-action" 
                    onClick={(e) => { e.stopPropagation(); handleContextMenu(e, 'container', container.id); }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* History Section (Renamed to 历史对话, hidden when collapsed) */}
        {!isCollapsed && (
          <div className="sidebar-section">
            <div className="sidebar-section-title">历史对话</div>
            <div className="sidebar-list">
              {sortedSessions.map(session => (
                <div 
                  key={session.id} 
                  className={`sidebar-item ${activeSessionId === session.id ? 'active' : ''}`}
                  onClick={() => selectSession(session.id)}
                  onContextMenu={(e) => handleContextMenu(e, 'session', session.id)}
                >
                  <History size={16} style={{ color: session.pinned ? 'var(--color-black)' : 'inherit' }} />
                  {editing?.id === session.id ? (
                    <input 
                      ref={editInputRef}
                      className="item-text"
                      style={{ border: 'none', background: 'transparent', outline: 'none', font: 'inherit', padding: 0 }}
                      value={editing.text}
                      onChange={e => setEditing({ ...editing, text: e.target.value })}
                      onBlur={handleRenameSubmit}
                      onKeyDown={e => e.key === 'Enter' && handleRenameSubmit()}
                      onClick={e => e.stopPropagation()}
                    />
                  ) : (
                    <span className="item-text">{session.title}</span>
                  )}
                  <button 
                    className="item-action" 
                    onClick={(e) => { e.stopPropagation(); handleContextMenu(e, 'session', session.id); }}
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="sidebar-footer">
        <div className="sidebar-user" style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: isCollapsed ? 'center' : 'space-between'
        }}>
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: isCollapsed ? 'center' : 'flex-start',
            gap: '12px', 
            overflow: 'hidden', 
            flex: isCollapsed ? 'none' : 1,
            width: isCollapsed ? '100%' : 'auto'
          }}>
            <img src="/head.jpeg" alt="Avatar" className="sidebar-avatar" />
            {!isCollapsed && <span className="sidebar-username">User</span>}
          </div>
          {!isCollapsed && (
            <button 
              className="sidebar-icon-btn" 
              onClick={onOpenSettings} 
              title="全局设置"
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
          <div className="context-overlay" onClick={closeContextMenu} style={{ backgroundColor: 'transparent' }} />
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
              重命名
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
              置顶 / 取消置顶
            </button>
            <div className="context-divider" />
            <button 
              className="context-item danger" 
              onClick={() => {
                if (contextMenu.type === 'session') deleteSession(contextMenu.id);
                else deleteContainer(contextMenu.id);
                closeContextMenu();
              }}
            >
              <Trash2 size={16} className="context-item-icon" />
              删除
            </button>
          </div>
        </>
      )}
    </div>
  );
};
