import type { ComponentType, CSSProperties, MouseEvent, RefObject } from 'react';
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
  icon: ComponentType<{ size?: number; style?: CSSProperties }>;
  onSelect: (id: string) => void;
  onOpenContext: (event: MouseEvent, id: string) => void;
  onEditChange: (id: string, text: string) => void;
  onEditSubmit: () => void;
  editInputRef: RefObject<HTMLInputElement | null>;
}

export function WorkspaceResourceList({ items, activeId, isCollapsed, emptyLabel, generatingId, editing, icon: Icon, onSelect, onOpenContext, onEditChange, onEditSubmit, editInputRef }: WorkspaceResourceListProps) {
  if (isCollapsed) return null;
  return <div className="sidebar-list">{items.length === 0 ? <div style={{ fontSize: '13px', color: 'var(--color-text-tertiary, #999)', textAlign: 'center', padding: '12px 0' }}>{emptyLabel}</div> : items.map((item) => {
    const label = 'title' in item ? item.title : item.name;
    const status = 'status' in item ? item.status : undefined;
    const isEditing = editing?.id === item.id;
    return <div key={item.id} className={`sidebar-item ${activeId === item.id ? 'active' : ''}`} onClick={() => onSelect(item.id)} onContextMenu={(event) => onOpenContext(event, item.id)}>
      <Icon size={16} style={{ flexShrink: 0, color: item.pinned ? 'var(--color-black)' : 'inherit' }} />
      {item.pinned && <Pin size={12} fill="currentColor" style={{ flexShrink: 0, marginLeft: '-4px', marginRight: '4px', opacity: 0.8 }} />}
      {isEditing ? <input ref={editInputRef} className="item-text" style={{ border: 'none', background: 'transparent', outline: 'none', font: 'inherit', padding: 0, minWidth: 0 }} value={editing.text} onChange={(event) => onEditChange(item.id, event.target.value)} onBlur={onEditSubmit} onKeyDown={(event) => event.key === 'Enter' && onEditSubmit()} onClick={(event) => event.stopPropagation()} /> : <span className="item-text">{label}</span>}
      {generatingId === item.id && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-text-secondary)' }} />}
      {status === 'running' && <Loader2 size={14} className="animate-spin" style={{ color: 'var(--color-primary)' }} />}
      {status === 'completed_unread' && <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }} />}
      {status === 'failed_unread' && <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#ef4444' }} />}
      <button className="item-action" onClick={(event) => { event.stopPropagation(); onOpenContext(event, item.id); }}><MoreHorizontal size={14} /></button>
    </div>;
  })}</div>;
}
