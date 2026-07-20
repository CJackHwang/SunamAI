import type { ComponentType, MouseEvent, RefObject } from 'react';
import { Loader2, MoreHorizontal, Pin } from 'lucide-react';
import type { Container, Session } from '@/entities/workspace/types';

type Resource = Session | Container;
interface WorkspaceResourceListProps {
  items: Resource[];
  activeId: string | null;
  isCollapsed: boolean;
  emptyLabel: string;
  generatingId: string | null;
  editing: { id: string; text: string } | null;
  icon: ComponentType<{ size?: number; className?: string }>;
  onSelect: (id: string) => void;
  onOpenContext: (event: MouseEvent, id: string) => void;
  onEditChange: (id: string, text: string) => void;
  onEditSubmit: () => void;
  editInputRef: RefObject<HTMLInputElement | null>;
}

export function WorkspaceResourceList({ items, activeId, isCollapsed, emptyLabel, generatingId, editing, icon: Icon, onSelect, onOpenContext, onEditChange, onEditSubmit, editInputRef }: WorkspaceResourceListProps) {
  if (isCollapsed) return null;
  return <div className="sidebar-list">{items.length === 0 ? <div className="sidebar-empty">{emptyLabel}</div> : items.map((item) => {
    const label = 'title' in item ? item.title : item.name;
    const status = 'status' in item ? item.status : undefined;
    const isEditing = editing?.id === item.id;
    return <div key={item.id} className={`sidebar-item list-row ${activeId === item.id ? 'active' : ''}`} onClick={() => onSelect(item.id)} onContextMenu={(event) => onOpenContext(event, item.id)}>
      <Icon size={16} className={item.pinned ? 'sidebar-resource-icon pinned' : 'sidebar-resource-icon'} />
      {item.pinned && <Pin size={12} fill="currentColor" className="sidebar-pin" />}
      {isEditing ? <input ref={editInputRef} className="item-text sidebar-item-input" value={editing.text} onChange={(event) => onEditChange(item.id, event.target.value)} onBlur={onEditSubmit} onKeyDown={(event) => event.key === 'Enter' && onEditSubmit()} onClick={(event) => event.stopPropagation()} /> : <span className="item-text">{label}</span>}
      {generatingId === item.id && <Loader2 size={14} className="animate-spin sidebar-generating" />}
      {status === 'running' && <Loader2 size={14} className="animate-spin sidebar-running" />}
      {status === 'completed_unread' && <span className="sidebar-status-dot success" />}
      {status === 'failed_unread' && <span className="sidebar-status-dot danger" />}
      <button className="item-action" onClick={(event) => { event.stopPropagation(); onOpenContext(event, item.id); }}><MoreHorizontal size={14} /></button>
    </div>;
  })}</div>;
}
