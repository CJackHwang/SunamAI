import { Edit2, Pin, Sparkles, Trash2 } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { SidebarContextMenuState, SidebarResource } from './sidebarResources';

interface SidebarResourceContextMenuProps {
  menu: SidebarContextMenuState;
  resource?: SidebarResource;
  dimmed: boolean;
  labels: { rename: string; generateTitle: string; pin: string; unpin: string; delete: string };
  onClose: () => void;
  onRename: () => void;
  onGenerateTitle: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}

export function SidebarResourceContextMenu({ menu, resource, dimmed, labels, onClose, onRename, onGenerateTitle, onTogglePin, onDelete }: SidebarResourceContextMenuProps) {
  const position = { '--context-menu-x': `${menu.x}px`, '--context-menu-y': `${menu.y}px` } as CSSProperties;
  return <>
    <div className={`context-overlay ${dimmed ? 'dimmed' : ''}`} onClick={onClose} />
    <div className="context-menu context-menu-positioned sidebar-context-menu" style={position}>
      <button className="context-item" onClick={onRename}><Edit2 size={16} className="context-item-icon" />{labels.rename}</button>
      <button className="context-item" onClick={onGenerateTitle}><Sparkles size={16} className="context-item-icon" />{labels.generateTitle}</button>
      <button className="context-item" onClick={onTogglePin}><Pin size={16} className="context-item-icon" />{resource?.pinned ? labels.unpin : labels.pin}</button>
      <div className="context-divider" />
      <button className="context-item danger" onClick={onDelete}><Trash2 size={16} className="context-item-icon" />{labels.delete}</button>
    </div>
  </>;
}
