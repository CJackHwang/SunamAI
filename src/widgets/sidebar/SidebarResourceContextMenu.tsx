import { Edit2, Pin, Sparkles, Trash2 } from 'lucide-react';
import { useRef, type CSSProperties } from 'react';
import { usePresence } from '@/shared/ui/usePresence';
import type { SidebarContextMenuState, SidebarResource } from './sidebarResources';

interface SidebarResourceContextMenuProps {
  menu: SidebarContextMenuState | null;
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
  const { presentValue: presentMenu, isExiting } = usePresence(menu);
  const lastResource = useRef(resource);
  if (resource) lastResource.current = resource;
  if (!presentMenu) return null;
  const position = { '--context-menu-x': `${presentMenu.x}px`, '--context-menu-y': `${presentMenu.y}px` } as CSSProperties;
  return <>
    <div className={`context-overlay ${dimmed ? 'dimmed' : ''} ${isExiting ? 'is-exiting' : ''}`} onClick={onClose} />
    <div className={`context-menu context-menu-positioned sidebar-context-menu ${isExiting ? 'is-exiting' : ''}`} style={position}>
      <button className="context-item" onClick={onRename}><Edit2 size={16} className="context-item-icon" />{labels.rename}</button>
      <button className="context-item" onClick={onGenerateTitle}><Sparkles size={16} className="context-item-icon" />{labels.generateTitle}</button>
      <button className="context-item" onClick={onTogglePin}><Pin size={16} className="context-item-icon" />{lastResource.current?.pinned ? labels.unpin : labels.pin}</button>
      <div className="context-divider" />
      <button className="context-item danger" onClick={onDelete}><Trash2 size={16} className="context-item-icon" />{labels.delete}</button>
    </div>
  </>;
}
