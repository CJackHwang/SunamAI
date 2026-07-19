import { Folder, MessageSquare, Monitor, Server, Terminal } from 'lucide-react';
import type { TerminalTab } from '@/features/terminal-session/types';

interface MobileNavigationProps { active: 'chat' | TerminalTab; onChange: (tab: 'chat' | TerminalTab) => void; }

export function MobileNavigation({ active, onChange }: MobileNavigationProps) {
  const items = [
    ['chat', MessageSquare], ['ai', Monitor], ['user', Terminal], ['files', Folder], ['services', Server],
  ] as const;
  return <div className="mobile-bottom-bar">{items.map(([tab, Icon]) => <button key={tab} className={active === tab ? 'active' : ''} onClick={() => onChange(tab)}><Icon size={24} /></button>)}</div>;
}
