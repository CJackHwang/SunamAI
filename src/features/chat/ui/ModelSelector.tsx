import { PanelLeft } from 'lucide-react';
import { usePresence } from '@/shared/ui/usePresence';

interface ModelSelectorOption {
  id: string;
  name: string;
}

interface ModelSelectorProps {
  model: string;
  options: ModelSelectorOption[];
  isOpen: boolean;
  onToggle: () => void;
  onSelect: (personaId: string) => void;
  onMobileSidebarToggle?: () => void;
}

/**
 * R5：聊天页顶部模型选择栏——只显示已启用的皮套（点选切换皮套即时生效）。
 * 样式与旧硬编码 SUNAM_MODELS 下拉一致，数据源改为皮套配置。
 */
export function ModelSelector({ model, options, isOpen, onToggle, onSelect, onMobileSidebarToggle }: ModelSelectorProps) {
  const { presentValue: isMenuPresent, isExiting } = usePresence(isOpen ? true : null);
  return (
    <header className="model-selector-header">
      <div className="workspace-header-left">
        <button className="mobile-sidebar-toggle sidebar-icon-btn" onClick={onMobileSidebarToggle}><PanelLeft size={20} /></button>
        <button className="model-selector-btn" aria-expanded={isOpen} onClick={onToggle}>{model}<svg className="model-selector-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg></button>
        {isMenuPresent && <><div className={`context-overlay dimmed model-selector-overlay ${isExiting ? 'is-exiting' : ''}`} onClick={onToggle} /><div className={`motion-pop-in model-selector-menu ${isExiting ? 'is-exiting' : ''}`}>{options.map((option) => <button key={option.id} className="context-item" onClick={() => onSelect(option.id)}>{option.name}</button>)}</div></>}
      </div>
    </header>
  );
}
