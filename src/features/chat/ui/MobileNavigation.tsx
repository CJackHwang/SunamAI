import { Folder, MessageSquare, Monitor, Server, Terminal } from 'lucide-react';
import type { TerminalTab } from '@/features/terminal-session/types';
import { useI18n } from '@/shared/i18n';
import './MobileNavigation.css';

interface MobileNavigationProps { active: 'chat' | TerminalTab; onChange: (tab: 'chat' | TerminalTab) => void; }

export function MobileNavigation({ active, onChange }: MobileNavigationProps) {
  const { t } = useI18n();
  const items = [
    ['chat', MessageSquare, 'chat.navigation'],
    ['ai', Monitor, 'terminal.aiComputer'],
    ['user', Terminal, 'terminal.shell'],
    ['files', Folder, 'terminal.files'],
    ['services', Server, 'terminal.services'],
  ] as const;
  return <nav className="mobile-bottom-bar" aria-label={t('chat.navigation')}>{items.map(([tab, Icon, label]) => <button key={tab} type="button" className={active === tab ? 'active' : ''} onClick={() => onChange(tab)} aria-label={t(label)} aria-current={active === tab ? 'page' : undefined}><Icon size={24} /></button>)}</nav>;
}
