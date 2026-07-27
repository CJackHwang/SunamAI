import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { LucideIcon } from 'lucide-react';
import { usePresence } from './usePresence';

export interface ActionMenuState {
  x: number;
  y: number;
}

export interface ActionMenuItem {
  id: string;
  label: string;
  icon: LucideIcon;
  onSelect: () => void | Promise<void>;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

interface ActionMenuProps<T extends ActionMenuState> {
  menu: T | null;
  items: (menu: T) => readonly ActionMenuItem[];
  onClose: () => void;
  ariaLabel: string;
  className?: string;
  dimmed?: boolean;
}

const VIEWPORT_INSET = 8;

export function ActionMenu<T extends ActionMenuState>({ menu, items, onClose, ariaLabel, className = '', dimmed = false }: ActionMenuProps<T>) {
  const { presentValue, isExiting } = usePresence(menu, 240);
  const menuRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const actions = presentValue ? items(presentValue) : [];

  useLayoutEffect(() => {
    if (!presentValue || !menuRef.current) return;
    const updatePosition = () => {
      const rect = menuRef.current!.getBoundingClientRect();
      setPosition({
        left: Math.max(VIEWPORT_INSET, Math.min(presentValue.x, window.innerWidth - rect.width - VIEWPORT_INSET)),
        top: Math.max(VIEWPORT_INSET, Math.min(presentValue.y, window.innerHeight - rect.height - VIEWPORT_INSET)),
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [actions.length, presentValue]);

  useEffect(() => {
    if (!presentValue || isExiting) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    menuRef.current?.querySelector<HTMLButtonElement>('.context-item:not(:disabled)')?.focus();
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isExiting, onClose, presentValue]);

  if (!presentValue) return null;
  const style = { '--context-menu-left': `${position.left}px`, '--context-menu-top': `${position.top}px` } as CSSProperties;
  return createPortal(<>
    <div className={`context-overlay action-menu-overlay ${dimmed ? 'dimmed' : ''} ${isExiting ? 'is-exiting' : ''}`} onClick={onClose} onContextMenu={(event) => { event.preventDefault(); onClose(); }} />
    <div ref={menuRef} className={`context-menu context-menu-positioned action-menu ${className} ${isExiting ? 'is-exiting' : ''}`} style={style} role="menu" aria-label={ariaLabel}>
      {actions.map((action) => <div key={action.id} className="action-menu-entry">
        {action.separatorBefore && <div className="context-divider" role="separator" />}
        <button type="button" role="menuitem" className={`context-item ${action.danger ? 'danger' : ''}`} disabled={action.disabled} onClick={() => { void action.onSelect(); onClose(); }}>
          <action.icon size={16} className="context-item-icon" />{action.label}
        </button>
      </div>)}
    </div>
  </>, document.body);
}
