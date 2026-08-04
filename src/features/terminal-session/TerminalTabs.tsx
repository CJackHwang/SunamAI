import { Maximize2, Minimize2, Monitor, PanelRightClose, SlidersHorizontal } from 'lucide-react';
import type { TerminalLayout, TerminalTab } from '@/shared/contracts/terminal';
import { useI18n } from '@/shared/i18n';
import './TerminalTabs.css';

interface TerminalTabsProps {
  activeTab: TerminalTab;
  onTabChange: (tab: TerminalTab) => void;
  layoutState: TerminalLayout;
  onLayoutChange?: (layout: TerminalLayout) => void;
  /** Whether container entries (terminal/files/services) are usable; the capability tab always stays. */
  containerAvailable?: boolean;
}

// The computer, user terminal, services, and files views all merged into the single
// "Sunam的电脑" (ai) container tab; capability stays as its own top-level tab. The
// sub-views are switched by the capsule island on that page.
const containerTabDefinitions = [
  ['ai', Monitor, 'terminal.aiComputer'],
] as const;
const capabilityTabDefinition = ['capability', SlidersHorizontal, 'capability.title'] as const;

function tabList(containerAvailable: boolean) {
  return [...(containerAvailable ? containerTabDefinitions : []), capabilityTabDefinition];
}

export function TerminalTabs({ activeTab, onTabChange, layoutState, onLayoutChange, containerAvailable = true }: TerminalTabsProps) {
  const { t } = useI18n();
  const tabs = tabList(containerAvailable);
  return (
    <div className="dual-terminal-tabs motion-fade-in">
      {tabs.map(([tab, Icon, label]) => <button key={tab} className={`terminal-tab-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => onTabChange(tab)}><Icon size={18} className="show-on-narrow" /><span className="hide-on-narrow">{t(label)}</span></button>)}
      <div className="terminal-tabs-spacer" />
      {onLayoutChange && <div className="terminal-layout-actions"><div className="terminal-tabs-divider" />{layoutState === 'half' ? <button className="desktop-only-btn terminal-icon-btn" onClick={() => onLayoutChange('full')} title={t('terminal.fullscreen')}><Maximize2 size={18} /></button> : <button className="desktop-only-btn terminal-icon-btn" onClick={() => onLayoutChange('half')} title={t('terminal.halfScreen')}><Minimize2 size={18} /></button>}<button className="desktop-only-btn terminal-icon-btn" onClick={() => onLayoutChange('collapsed')} title={t('terminal.collapse')}><PanelRightClose size={18} /></button></div>}
    </div>
  );
}

export function CollapsedTerminalNav({ activeTab, onTabChange, onExpand, containerAvailable = true }: { activeTab: TerminalTab; onTabChange: (tab: TerminalTab) => void; onExpand: () => void; containerAvailable?: boolean }) {
  const { t } = useI18n();
  const tabs = tabList(containerAvailable);
  return <div className="desktop-only-btn collapsed-terminal-nav motion-fade-in">{tabs.map(([tab, Icon, label]) => <button key={tab} className={`right-sidebar-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => { onTabChange(tab); onExpand(); }} title={t(label)}><Icon size={20} /></button>)}</div>;
}
