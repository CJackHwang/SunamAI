import { Edit2, Pin, Sparkles, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { ActionMenu } from '@/shared/ui/ActionMenu';
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
  const lastResource = useRef(resource);
  if (resource) lastResource.current = resource;
  return <ActionMenu menu={menu} onClose={onClose} ariaLabel={labels.rename} className="sidebar-context-menu" dimmed={dimmed} items={() => [
    { id: 'rename', label: labels.rename, icon: Edit2, onSelect: onRename },
    { id: 'generate-title', label: labels.generateTitle, icon: Sparkles, onSelect: onGenerateTitle },
    { id: 'toggle-pin', label: lastResource.current?.pinned ? labels.unpin : labels.pin, icon: Pin, onSelect: onTogglePin },
    { id: 'delete', label: labels.delete, icon: Trash2, onSelect: onDelete, danger: true, separatorBefore: true },
  ]} />;
}
