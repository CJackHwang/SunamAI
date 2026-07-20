import { Check, Copy, ExternalLink, StopCircle } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/shared/i18n';
import type { ProcessStatus } from '@/shared/contracts/agentRuntime';
import { toErrorMessage } from '@/shared/lib/errors';
import { toDisplayWorkspacePath } from './displayPaths';
import { EmptyState, ErrorState } from '@/shared/ui/AsyncState';
import './ServicesPanel.css';

interface ServicePanelProps {
  ports: Array<{ port: number; url: string }>;
  processes: ProcessStatus[];
  containerName: string;
  onKillProcess: (process: ProcessStatus) => void;
}

export function ServicesPanel({ ports, processes, containerName, onKillProcess }: ServicePanelProps) {
  const { t, format } = useI18n();
  const [copiedPort, setCopiedPort] = useState<number | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);

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

  return <div className="services-panel motion-panel-in">
    <section className="services-ports" aria-labelledby="runtime-ports-heading">
      <div className="services-heading-row">
        <h3 id="runtime-ports-heading"><span className="status-dot status-dot-success" />{t('services.ports')}</h3>
        <span className="services-scope">{t('services.runtimeScope')}</span>
      </div>
      {ports.length === 0
        ? <EmptyState className="panel-empty-state">{t('services.noPorts')}</EmptyState>
        : <div className="services-port-list">{ports.map((port) => <div className="service-row list-row service-port-row" key={port.port}>
          <span className="service-port-number">{format('services.port', { port: port.port })}</span>
          <a href={port.url} target="_blank" rel="noopener noreferrer" title={port.url}>{port.url}<ExternalLink size={14} /></a>
          <button className="icon-button" onClick={() => { void copyAddress(port.port, port.url); }} title={t('services.copy')} aria-label={format('services.copyPort', { port: port.port })}>
            {copiedPort === port.port ? <Check size={16} /> : <Copy size={16} />}
          </button>
        </div>)}</div>}
      {copyError && <ErrorState className="panel-inline-error">{copyError}</ErrorState>}
    </section>

    <section className="services-processes" aria-labelledby="container-processes-heading">
      <div className="services-heading-row">
        <h3 id="container-processes-heading"><span className="status-dot" />{t('services.processes')}</h3>
        <span className="services-count">{processes.length}</span>
      </div>
      <div className="services-process-list scroll-region">{processes.length === 0
        ? <EmptyState className="panel-empty-state services-process-empty">{t('services.noProcesses')}</EmptyState>
        : processes.map((process) => <div className="service-row list-row service-process-row" key={process.id}>
          <div className="service-process-details">
            <span className="service-process-id">{process.id}</span>
            <span className="service-process-command" title={`$ ${toDisplayWorkspacePath(process.command, containerName)}`}>$ {toDisplayWorkspacePath(process.command, containerName)}</span>
          </div>
          <button className="icon-button icon-button-danger" onClick={() => onKillProcess(process)} title={t('services.kill')} aria-label={`${t('services.kill')} ${process.id}`}><StopCircle size={18} /></button>
        </div>)}</div>
    </section>
  </div>;
}
