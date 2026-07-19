import { StopCircle, Trash2 } from 'lucide-react';
import { useI18n } from '@/shared/i18n';
import type { ProcessStatus } from '@/shared/contracts/agentRuntime';

interface ServicePanelProps {
  ports: Array<{ port: number; url: string }>;
  processes: ProcessStatus[];
  onClearPort: (port: number) => void;
  onKillProcess: (processId: string) => void;
}

const cardStyle = {
  flex: 1,
  minHeight: '180px',
  padding: '24px',
  backgroundColor: 'var(--color-bg)',
  borderRadius: 'var(--radius-large)',
};

const headingStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  marginBottom: '12px',
  color: 'var(--color-text)',
  fontSize: '14px',
  fontWeight: 600,
};

const emptyStateStyle = {
  padding: '16px',
  color: 'var(--color-text-secondary)',
  fontSize: '13px',
  textAlign: 'center' as const,
};

export function ServicesPanel({ ports, processes, onClearPort, onKillProcess }: ServicePanelProps) {
  const { t, format } = useI18n();
  const runningProcesses = processes.filter((process) => process.isRunning);

  return (
    <div
      className="motion-panel-in"
      style={{
        display: 'flex',
        flex: 1,
        flexDirection: 'column',
        gap: '16px',
        height: '100%',
        overflowY: 'auto',
        padding: '16px',
        backgroundColor: 'var(--color-surface)',
        borderRadius: 'var(--radius-large)',
      }}
    >
      <section className="services-section" style={cardStyle}>
        <h3 style={headingStyle}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-success)' }} />
          {t('services.ports')}
        </h3>
        {ports.length === 0 ? (
          <div style={emptyStateStyle}>{t('services.noPorts')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {ports.map((port) => (
              <div key={port.port} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px', border: '1px solid var(--color-border)', borderRadius: '6px', backgroundColor: 'var(--color-surface)' }}>
                <div style={{ display: 'flex', flex: 1, alignItems: 'center', gap: '12px', minWidth: 0 }}>
                  <span style={{ color: 'var(--color-text)', fontSize: '14px', fontWeight: 500, whiteSpace: 'nowrap' }}>{format('services.port', { port: port.port })}</span>
                  <a href={port.url} target="_blank" rel="opener" title={port.url} style={{ overflow: 'hidden', color: 'var(--color-primary)', fontSize: '13px', textOverflow: 'ellipsis', textDecoration: 'none', whiteSpace: 'nowrap' }}>{port.url} ↗</a>
                </div>
                <button onClick={() => onClearPort(port.port)} title={t('services.clear')} style={{ display: 'flex', flexShrink: 0, padding: '6px', borderRadius: '4px', color: '#ff4d4f' }}><Trash2 size={16} /></button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="services-section" style={cardStyle}>
        <h3 style={headingStyle}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: 'var(--color-primary)' }} />
          {t('services.processes')}
        </h3>
        {runningProcesses.length === 0 ? (
          <div style={emptyStateStyle}>{t('services.noProcesses')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {runningProcesses.map((process) => (
              <div key={process.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: '12px', border: '1px solid var(--color-border)', borderRadius: '6px', backgroundColor: 'var(--color-surface)' }}>
                <div style={{ display: 'flex', flex: 1, flexDirection: 'column', gap: '4px', minWidth: 0, overflow: 'hidden' }}>
                  <div style={{ color: 'var(--color-text-secondary)', fontFamily: 'monospace', fontSize: '12px' }}>{process.id}</div>
                  <div title={`$ ${process.command}`} style={{ overflow: 'hidden', color: 'var(--color-text)', fontSize: '14px', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>$ {process.command}</div>
                </div>
                <button onClick={() => onKillProcess(process.id)} title={t('services.kill')} style={{ display: 'flex', flexShrink: 0, padding: '6px', borderRadius: '4px', color: '#ff4d4f' }}><StopCircle size={18} /></button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
