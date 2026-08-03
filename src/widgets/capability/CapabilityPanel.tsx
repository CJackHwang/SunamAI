import { useEffect, useState } from 'react';
import { ChevronDown, X } from 'lucide-react';
import { useI18n, type TranslationKey } from '@/shared/i18n';
import type { CapabilityModuleId } from '@/shared/contracts/capability';
import type { RegisteredTool } from '@/features/agent-core/tools/base';
import { useIntrinsicDisclosure } from '@/shared/ui/useIntrinsicDisclosure';
import { useCapabilityContext, type CapabilityModuleView } from './CapabilityContext';
import { CapabilitySwitch } from './CapabilitySwitch';
import './CapabilityPanel.css';

function confirmDisable(label: string, format: (key: TranslationKey, values: Record<string, string | number>) => string): boolean {
  return window.confirm(format('capability.toggle.confirm', { name: label }));
}

function ToolRow({ tool, moduleOn, onShowInfo }: { tool: RegisteredTool; moduleOn: boolean; onShowInfo: (tool: RegisteredTool) => void }) {
  const { t, format } = useI18n();
  const { config, toggleTool } = useCapabilityContext();
  const checked = moduleOn && (config.tools[tool.name] ?? tool.capability.defaultEnabled);
  const warn = tool.capability.warnOnDisable ?? false;
  const deps = tool.capability.dependencies ?? [];

  const handleToggle = (next: boolean) => {
    if (!next && warn && !confirmDisable(tool.name, format)) return;
    toggleTool(tool.name, next);
  };

  return (
    <div className="capability-tool-row">
      <button type="button" className="capability-tool-info" onClick={() => onShowInfo(tool)}>
        <span className="capability-tool-name-row">
          <span className="capability-tool-name">{tool.name}</span>
          {warn && <span className="capability-warn-badge">{t('capability.warnOnDisable')}</span>}
          {deps.length > 0 && <span className="capability-dep-hint">{format('capability.dependsOn', { name: deps.join(', ') })}</span>}
        </span>
        <span className="capability-tool-desc">{tool.description}</span>
      </button>
      <CapabilitySwitch checked={checked} onChange={handleToggle} label={tool.name} disabled={!moduleOn} />
    </div>
  );
}

/** Module row that expands to its tool list. Uses native <details> + the shared disclosure owner. */
function ModuleDisclosure({ view, onShowInfo }: { view: CapabilityModuleView; onShowInfo: (tool: RegisteredTool) => void }) {
  const { t, format } = useI18n();
  const { config, effectiveContainerState, toggleModule, retryContainer, containerSwitchLocked } = useCapabilityContext();
  const { disclosureRef, toggleDisclosure } = useIntrinsicDisclosure({ contentSelector: '.capability-module-body' });

  const id = view.descriptor.id;
  const isContainer = id === 'virtual-container';
  const restricted = isContainer && effectiveContainerState === 'restricted';
  // The container switch is strongly bound to its real state: on ONLY when the container
  // is actually enabled. Restricted/disabled both show the switch off, so the switch can
  // never read "on" while the container is stopped (no misalignment).
  const moduleOn = isContainer
    ? effectiveContainerState === 'enabled'
    : (config.modules[id]?.enabled ?? true);
  const moduleHasWarn = view.tools.some((tool) => tool.capability.warnOnDisable);

  const label = view.descriptor.label ?? t(view.descriptor.labelKey as TranslationKey);

  const handleMasterToggle = (requested: boolean) => {
    if (isContainer) {
      if (containerSwitchLocked) return; // run 活跃：禁止关闭/重试
      if (restricted) {
        void retryContainer();
        return;
      }
      toggleModule('virtual-container', requested);
      return;
    }
    if (!requested && moduleHasWarn && !confirmDisable(label, format)) return;
    toggleModule(id as CapabilityModuleId, requested);
  };

  // Restricted: the row cannot expand; clicking it retries the container (unless locked).
  const handleSummaryClick = restricted
    ? (event: React.MouseEvent<HTMLElement>) => { event.preventDefault(); if (!containerSwitchLocked) void retryContainer(); }
    : toggleDisclosure;

  return (
    <details ref={disclosureRef} className={`capability-details${restricted ? ' is-restricted' : ''}`}>
      <summary className="capability-module-head" onClick={handleSummaryClick}>
        <div className="capability-module-title">
          <span className="capability-module-name-row">
            <span className="capability-module-name">{label}</span>
            {moduleHasWarn && <span className="capability-warn-badge">{t('capability.warnOnDisable')}</span>}
            {restricted && <span className="capability-status-note">{t('capability.status.restricted')}</span>}
          </span>
          <span className="capability-module-desc">{t(view.descriptor.descriptionKey as TranslationKey)}</span>
        </div>
        <ChevronDown size={16} className={`capability-chevron${restricted ? ' is-locked' : ''}`} />
        <CapabilitySwitch
          checked={moduleOn}
          onChange={handleMasterToggle}
          label={label}
          disabled={isContainer && containerSwitchLocked}
          {...(isContainer && containerSwitchLocked ? { title: t('capability.switchLockedHint') } : {})}
        />
      </summary>
      <div className="capability-module-body">
        {view.tools.map((tool) => <ToolRow key={tool.name} tool={tool} moduleOn={moduleOn} onShowInfo={onShowInfo} />)}
      </div>
    </details>
  );
}

/** Non-expandable module row (reserved notes / empty other): shows its hint, no chevron. */
function ModuleRow({ view, onShowInfo }: { view: CapabilityModuleView; onShowInfo: (tool: RegisteredTool) => void }) {
  const { t } = useI18n();
  const id = view.descriptor.id;
  const label = view.descriptor.label ?? t(view.descriptor.labelKey as TranslationKey);
  const isNotes = id === 'notes';
  const isContainer = id === 'virtual-container';

  if (view.tools.length === 0 && !isContainer) {
    return (
      <section className="capability-module">
        <div className="capability-module-head capability-module-head-static">
          <div className="capability-module-title">
            <span className="capability-module-name-row">
              <span className="capability-module-name">{label}</span>
            </span>
            <span className="capability-module-desc">{t(view.descriptor.descriptionKey as TranslationKey)}</span>
            <span className="capability-notes-placeholder">{isNotes ? t('capability.notes.placeholder') : t('capability.empty.other')}</span>
          </div>
        </div>
      </section>
    );
  }

  return <ModuleDisclosure view={view} onShowInfo={onShowInfo} />;
}

/** Capability panel: one row per module with per-tool sub-switches. Fills the right column. */
export function CapabilityPanel() {
  const { t } = useI18n();
  const { modules } = useCapabilityContext();
  const [infoTool, setInfoTool] = useState<RegisteredTool | null>(null);

  useEffect(() => {
    if (!infoTool) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setInfoTool(null); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [infoTool]);

  return (
    <aside className="capability-rail">
      <div className="capability-panel">
        <header className="capability-header">
          <span className="capability-title">{t('capability.title')}</span>
          <span className="capability-note">{t('capability.subtitle')} · {t('capability.nextRunNote')}</span>
        </header>
        <div className="capability-module-list">
          {modules.map((view) => <ModuleRow key={view.descriptor.id} view={view} onShowInfo={setInfoTool} />)}
        </div>
      </div>
      {infoTool && (
        <div className="capability-info-overlay motion-fade-in" role="dialog" aria-modal="true" onClick={() => setInfoTool(null)}>
          <div className="capability-info-card motion-rise-in" onClick={(event) => event.stopPropagation()}>
            <header className="capability-info-header">
              <span className="capability-info-name">{infoTool.name}</span>
              <button type="button" className="capability-info-close" onClick={() => setInfoTool(null)} aria-label={t('common.close')}><X size={16} /></button>
            </header>
            <p className="capability-info-desc">{infoTool.description}</p>
          </div>
        </div>
      )}
    </aside>
  );
}
