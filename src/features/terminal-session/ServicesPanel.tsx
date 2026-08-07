import { Check, Copy, Loader2, MonitorPlay, StopCircle } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/shared/i18n';
import type { ProcessStatus } from '@/shared/contracts/agentRuntime';
import type { RuntimePortStatus } from '@/shared/contracts/terminal';
import { toErrorMessage } from '@/shared/lib/errors';
import { EmptyState, ErrorState } from '@/shared/ui/AsyncState';
import './ServicesPanel.css';

/** 进程归属（TASK-CISOL R4）：与 runtime succinixProcesses 的 ProcessScope 结构一致（string 联合）。 */
type ProcessScope = 'system' | 'container' | 'unknown';

/** 进程行展示视图：ProcessStatus 之上附加 protected（系统进程禁 stop）、pid/processId（kill 路由用）
 *  与 scope（TASK-CISOL R4：按归属分组显示：system / container / unknown）。 */
export type ServiceProcessView = ProcessStatus & { protected?: boolean; pid?: number; processId?: string; killable?: boolean; scope?: ProcessScope };

interface ServicePanelProps {
  ports: RuntimePortStatus[];
  processes: ServiceProcessView[];
  isRestarting: boolean;
  onPreview: (port: number, url: string) => void;
  onStopPort: (port: number) => Promise<boolean>;
  onForceRestart: () => Promise<void>;
  onKillProcess: (process: ServiceProcessView) => void;
}

/** 分组归属：host 已标 scope 直接用；旧视图（无 scope）按 protected 回落（系统 → system，其余 → 当前容器）。 */
function groupOf(process: ServiceProcessView): ProcessScope {
  if (process.scope) return process.scope;
  return process.protected === true ? 'system' : 'container';
}

export function ServicesPanel({ ports, processes, isRestarting, onPreview, onStopPort, onForceRestart, onKillProcess }: ServicePanelProps) {
  const { t, format } = useI18n();
  const [copiedPort, setCopiedPort] = useState<number | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyPort, setBusyPort] = useState<number | null>(null);
  const stateLabel = (state: Exclude<RuntimePortStatus['state'], 'managed'>) => {
    switch (state) {
      case 'identifying': return t('services.state.identifying');
      case 'orphaned': return t('services.state.orphaned');
      case 'stopping': return t('services.state.stopping');
    }
  };

  const copyAddress = async (port: number, url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopyError(null);
      setCopiedPort(port);
      window.setTimeout(() => setCopiedPort((current) => current === port ? null : current), 1_500);
    } catch (error) {
      setCopyError(`${t('services.copyFailed')}: ${toErrorMessage(error)}`);
    }
  };

  const stopPort = async (port: number) => {
    setBusyPort(port);
    setActionError(null);
    try {
      if (!await onStopPort(port)) setActionError(t('services.stopFailed'));
    } catch (error) {
      setActionError(`${t('services.stopFailed')}: ${toErrorMessage(error)}`);
    } finally {
      setBusyPort(null);
    }
  };

  const forceRestart = async () => {
    if (!window.confirm(t('services.forceRestartConfirm'))) return;
    setActionError(null);
    try {
      await onForceRestart();
    } catch (error) {
      setActionError(`${t('services.forceRestartFailed')}: ${toErrorMessage(error)}`);
    }
  };

  // TASK-CISOL R4：按归属分三组 —— 系统进程（protected 徽标 + 禁 stop + 运行时说明）、
  // 当前容器进程（可 stop）、未知归属（灰显禁操作）。分组是数据驱动渲染，不改样式。
  const systemProcesses = processes.filter((process) => groupOf(process) === 'system');
  const containerProcesses = processes.filter((process) => groupOf(process) === 'container');
  const unknownProcesses = processes.filter((process) => groupOf(process) === 'unknown');
  const renderProcessRow = (process: ServiceProcessView) => {
    // V1 H1-2：kill 语义如实 —— protected（系统进程）、killable:false（前台 run 语义、
    // 无 host pid，Lifo 混合链运行中不可中途终止）与 scope=unknown（归属未知，宁严勿松）
    // 都禁 stop，并给出对应说明文案。
    const killDisabled = process.protected === true || process.killable === false || process.scope === 'unknown';
    const killLabel = process.protected === true
      ? t('services.killBlocked')
      : process.scope === 'unknown'
        ? t('services.killUnknown')
        : process.killable === false
          ? t('services.killUnavailable')
          : t('services.kill');
    return <div className="service-row list-row service-process-row" key={process.id}>
      <div className="service-process-details">
        <span className="service-process-id">{process.protected ? `[${t('services.systemProcess')}] ${process.id}` : process.id}</span>
        <span className="service-process-command" title={`$ ${process.command}`}>$ {process.command}</span>
        {process.protected === true && <span className="service-process-id">{t('services.systemProcessNote')}</span>}
      </div>
      <button className="icon-button icon-button-danger" onClick={() => onKillProcess(process)} title={killLabel} aria-label={`${killLabel} ${process.id}`} disabled={killDisabled}><StopCircle size={18} /></button>
    </div>;
  };

  return <div className="services-panel motion-panel-in">
    <section className="services-ports" aria-labelledby="runtime-ports-heading">
      <div className="services-heading-row">
        <h3 id="runtime-ports-heading"><span className="status-dot status-dot-success" />{t('services.ports')}</h3>
        <span className="services-scope">{t('services.runtimeScope')}</span>
      </div>
      {ports.length === 0
        ? <EmptyState className="panel-empty-state">{t('services.noPorts')}</EmptyState>
        : <div className="services-port-list">{ports.map((port) => <div className="service-row list-row service-port-row" key={port.port}>
          <button type="button" className="service-preview-trigger" onClick={() => onPreview(port.port, port.url)} title={port.url} aria-label={format('services.previewPort', { port: port.port })} disabled={!port.url}>
            <span className="service-port-number">{format('services.port', { port: port.port })}{port.state !== 'managed' && <span className={`service-port-state service-port-state-${port.state}`}>{stateLabel(port.state)}</span>}</span>
            <span className="service-port-url">{port.url}</span>
            <MonitorPlay size={16} />
          </button>
          <button className="icon-button" onClick={() => { void copyAddress(port.port, port.url); }} title={t('services.copy')} aria-label={format('services.copyPort', { port: port.port })} disabled={!port.url || isRestarting}>
            {copiedPort === port.port ? <Check size={16} /> : <Copy size={16} />}
          </button>
          {port.state === 'managed' || port.state === 'stopping'
            ? <button className="icon-button icon-button-danger" onClick={() => { void stopPort(port.port); }} title={t('services.stop')} aria-label={format('services.stopPort', { port: port.port })} disabled={port.state === 'stopping' || busyPort === port.port || isRestarting}>{busyPort === port.port || port.state === 'stopping' ? <Loader2 className="lucide-spin" size={18} /> : <StopCircle size={18} />}</button>
            : port.state === 'orphaned'
              ? <button className="btn btn-danger services-force-restart" onClick={() => { void forceRestart(); }} disabled={isRestarting}><span className="services-warning-mark" aria-hidden="true">!</span>{isRestarting ? t('services.restarting') : t('services.forceRestart')}</button>
              : <span className="services-identifying" role="status"><Loader2 className="lucide-spin" size={16} />{t('services.identifying')}</span>}
        </div>)}</div>}
      {copyError && <ErrorState className="panel-inline-error">{copyError}</ErrorState>}
      {actionError && <ErrorState className="panel-inline-error">{actionError}</ErrorState>}
      {isRestarting && <div className="services-restart-status" role="status"><Loader2 className="lucide-spin" size={16} />{t('services.restarting')}</div>}
    </section>

    <section className="services-processes" aria-labelledby="container-processes-heading">
      <div className="services-heading-row">
        <h3 id="container-processes-heading"><span className="status-dot" />{t('services.processes')}</h3>
        <span className="services-count">{processes.length}</span>
      </div>
      <div className="services-process-list scroll-region">{processes.length === 0
        ? <EmptyState className="panel-empty-state services-process-empty">{t('services.noProcesses')}</EmptyState>
        : <>
          {systemProcesses.length > 0 && <div className="services-process-group" role="group" aria-label={t('services.groupSystem')}><span className="service-process-id">{t('services.groupSystem')}</span>{systemProcesses.map(renderProcessRow)}</div>}
          {containerProcesses.length > 0 && <div className="services-process-group" role="group" aria-label={t('services.groupContainer')}><span className="service-process-id">{t('services.groupContainer')}</span>{containerProcesses.map(renderProcessRow)}</div>}
          {unknownProcesses.length > 0 && <div className="services-process-group" role="group" aria-label={t('services.groupUnknown')}><span className="service-process-id">{t('services.groupUnknown')}</span>{unknownProcesses.map(renderProcessRow)}</div>}
        </>}</div>
    </section>
  </div>;
}
