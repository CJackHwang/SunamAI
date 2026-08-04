import { MessageSquare, Monitor, SlidersHorizontal } from 'lucide-react';
import type { TerminalTab } from '@/shared/contracts/terminal';
import { useI18n } from '@/shared/i18n';
import './MobileNavigation.css';

interface MobileNavigationProps { active: 'chat' | TerminalTab; onChange: (tab: 'chat' | TerminalTab) => void; showContainerTabs?: boolean; }

export function MobileNavigation({ active, onChange, showContainerTabs = true }: MobileNavigationProps) {
  const { t } = useI18n();
  // The user terminal, services, and files all live inside the "Sunam的电脑" (ai) page;
  // segment switching happens through the capsule island on that page.
  const containerTabs = [
    ['ai', Monitor, 'terminal.aiComputer'],
  ] as const;
  const items = [
    ['chat', MessageSquare, 'chat.navigation'],
    ...(showContainerTabs ? containerTabs : []),
    ['capability', SlidersHorizontal, 'capability.title'],
  ] as const;
  return <nav className="mobile-bottom-bar" aria-label={t('chat.navigation')}>{items.map(([tab, Icon, label]) => <button key={tab} type="button" className={active === tab ? 'active' : ''} onClick={() => onChange(tab)} aria-label={t(label)} aria-current={active === tab ? 'page' : undefined}><Icon size={24} /></button>)}</nav>;
}
