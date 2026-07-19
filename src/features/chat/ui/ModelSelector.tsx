import { PanelLeft } from 'lucide-react';
import type { SunamModel } from '@/shared/config/models';
import { SUNAM_MODELS } from '@/shared/config/models';

interface ModelSelectorProps {
  model: SunamModel;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (model: SunamModel) => void;
  onMobileSidebarToggle?: () => void;
}

export function ModelSelector({ model, isOpen, onToggle, onSelect, onMobileSidebarToggle }: ModelSelectorProps) {
  return (
    <header style={{ height: '54px', display: 'flex', alignItems: 'center', padding: '0 16px', flexShrink: 0, backgroundColor: 'color-mix(in srgb, var(--color-bg) 75%, transparent)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', borderBottom: 'none', position: 'absolute', top: 0, left: 0, right: 0, zIndex: 50 }}>
      <div className="workspace-header-left" style={{ margin: 0 }}>
        <button className="mobile-sidebar-toggle sidebar-icon-btn" style={{ display: 'none' }} onClick={onMobileSidebarToggle}><PanelLeft size={20} /></button>
        <button className="model-selector-btn" onClick={onToggle} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '18px', fontWeight: 600, color: 'var(--color-text)', padding: '8px 12px', borderRadius: 'var(--radius-small)', transition: 'background-color 0.2s', border: 'none', background: 'transparent', cursor: 'pointer' }}>{model}<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-text-secondary)' }}><path d="m6 9 6 6 6-6" /></svg></button>
        {isOpen && <><div className="context-overlay dimmed" onClick={onToggle} style={{ top: '-100vh', bottom: '-100vh', left: '-100vw', right: '-100vw', zIndex: 900 }} /><div className="motion-pop-in" style={{ position: 'absolute', top: '100%', left: 0, marginTop: '4px', backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-medium)', boxShadow: 'var(--elevation-4)', padding: '4px', minWidth: '180px', zIndex: 1001, display: 'flex', flexDirection: 'column' }}>{SUNAM_MODELS.map((candidate) => <button key={candidate} className="context-item" onClick={() => onSelect(candidate)}>{candidate}</button>)}</div></>}
      </div>
    </header>
  );
}
