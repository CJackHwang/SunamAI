import { Folder, Maximize2, Minimize2, Monitor, PanelRightClose, Server, Terminal as TerminalIcon } from 'lucide-react';
import type { TerminalLayout, TerminalTab } from './types';
import { useI18n } from '@/shared/i18n';

interface TerminalTabsProps {
  activeTab: TerminalTab;
  onTabChange: (tab: TerminalTab) => void;
  layoutState: TerminalLayout;
  onLayoutChange?: (layout: TerminalLayout) => void;
}

const tabDefinitions = [
  ['ai', Monitor, 'terminal.aiComputer'], ['user', TerminalIcon, 'terminal.shell'], ['files', Folder, 'terminal.files'], ['services', Server, 'terminal.services'],
] as const;

export function TerminalTabs({ activeTab, onTabChange, layoutState, onLayoutChange }: TerminalTabsProps) {
  const { t } = useI18n();
  return (
    <div className="dual-terminal-tabs" style={{ display: 'flex', gap: '8px', padding: '0 16px', height: '54px', borderBottom: '1px solid var(--color-border)', alignItems: 'center', overflowX: 'auto', flexShrink: 0 }}>
      {tabDefinitions.map(([tab, Icon, label]) => <button key={tab} className={`terminal-tab-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => onTabChange(tab)}><Icon size={tab === 'ai' || tab === 'user' ? 18 : 16} className="show-on-narrow" /><span className="hide-on-narrow">{t(label)}</span></button>)}
      <div style={{ flex: 1 }} />
      {onLayoutChange && <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: '1px', height: '16px', backgroundColor: 'var(--color-border)', margin: '0 12px 0 8px' }} />{layoutState === 'half' ? <button className="desktop-only-btn terminal-icon-btn" onClick={() => onLayoutChange('full')} title={t('terminal.fullscreen')}><Maximize2 size={18} /></button> : <button className="desktop-only-btn terminal-icon-btn" onClick={() => onLayoutChange('half')} title={t('terminal.halfScreen')}><Minimize2 size={18} /></button>}<button className="desktop-only-btn terminal-icon-btn" onClick={() => onLayoutChange('collapsed')} title={t('terminal.collapse')}><PanelRightClose size={18} /></button></div>}
    </div>
  );
}

export function CollapsedTerminalNav({ activeTab, onTabChange, onExpand }: { activeTab: TerminalTab; onTabChange: (tab: TerminalTab) => void; onExpand: () => void }) {
  const { t } = useI18n();
  return <div className="desktop-only-btn" style={{ display: 'flex', flexDirection: 'column', width: '56px', height: '100%', alignItems: 'center', paddingTop: '16px', gap: '12px', backgroundColor: 'var(--color-surface)' }}>{tabDefinitions.map(([tab, Icon, label]) => <button key={tab} className={`right-sidebar-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => { onTabChange(tab); onExpand(); }} title={t(label)}><Icon size={20} /></button>)}</div>;
}
