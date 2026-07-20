import { PanelLeft } from 'lucide-react';
import type { SunamModel } from '@/shared/config/models';
import { SUNAM_MODELS } from '@/shared/config/models';
import { usePresence } from '@/shared/ui/usePresence';

interface ModelSelectorProps {
  model: SunamModel;
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (model: SunamModel) => void;
  onMobileSidebarToggle?: () => void;
}

export function ModelSelector({ model, isOpen, onToggle, onSelect, onMobileSidebarToggle }: ModelSelectorProps) {
  const { presentValue: isMenuPresent, isExiting } = usePresence(isOpen ? true : null);
  return (
    <header className="model-selector-header">
      <div className="workspace-header-left">
        <button className="mobile-sidebar-toggle sidebar-icon-btn" onClick={onMobileSidebarToggle}><PanelLeft size={20} /></button>
        <button className="model-selector-btn" aria-expanded={isOpen} onClick={onToggle}>{model}<svg className="model-selector-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></button>
        {isMenuPresent && <><div className={`context-overlay dimmed model-selector-overlay ${isExiting ? 'is-exiting' : ''}`} onClick={onToggle} /><div className={`motion-pop-in model-selector-menu ${isExiting ? 'is-exiting' : ''}`}>{SUNAM_MODELS.map((candidate) => <button key={candidate} className="context-item" onClick={() => onSelect(candidate)}>{candidate}</button>)}</div></>}
      </div>
    </header>
  );
}
