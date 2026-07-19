import { Activity, CheckCircle2, Circle, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { useI18n } from '@/shared/i18n';
import { projectProgress, projectRunEvents } from './projector';
import type { AgentEvent, AgentRun } from './types';

interface RunBoardProps {
  run: AgentRun | null;
  events: AgentEvent[];
  liveOutput?: string;
  onResume?: () => void;
}

export function RunBoard({ run, events, liveOutput, onResume }: RunBoardProps) {
  const { t } = useI18n();
  if (!run) return null;
  const runEvents = projectRunEvents(events, run.id);
  const progress = projectProgress(events, run.id);
  const verification = [...runEvents].reverse().find((event) => event.kind === 'verification');
  const isVerified = verification?.passed ?? run.task.verified;
  const tools = runEvents.filter((event) => event.kind === 'tool_finished').slice(-4);
  const icon = run.phase === 'failed' ? <XCircle size={16} /> : run.phase === 'completed' ? <CheckCircle2 size={16} /> : <Activity size={16} />;
  return <section className="motion-fade-in" style={{ border: '1px solid var(--color-border)', background: 'linear-gradient(135deg, color-mix(in srgb, var(--color-surface) 92%, #7c3aed 8%), var(--color-surface))', borderRadius: 'var(--radius-medium)', padding: '14px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ display: 'inline-flex', color: run.phase === 'failed' ? '#dc2626' : run.phase === 'completed' ? 'var(--color-success)' : 'var(--color-primary)' }}>{icon}</span>
      <strong style={{ fontSize: '13px' }}>{t('agent.runBoard')}</strong>
      <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-secondary)' }}>{run.phase}</span>
    </div>
    <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)' }}>{t('agent.ritual')}: {run.chaos.ritual}</div>
    {run.error && <div style={{ fontSize: '12px', color: '#dc2626', whiteSpace: 'pre-wrap' }}>{run.error}</div>}
    {(progress || liveOutput) && <div style={{ fontSize: '13px', color: 'var(--color-text)', whiteSpace: 'pre-wrap', maxHeight: '90px', overflowY: 'auto' }}>{progress || liveOutput}</div>}
    {run.task.plan.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>{run.task.plan.map((item) => <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: item.status === 'completed' ? 'var(--color-text-secondary)' : 'var(--color-text)' }}>{item.status === 'completed' ? <CheckCircle2 size={14} color="var(--color-success)" /> : <Circle size={14} />}{item.title}</div>)}</div>}
    <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
      <span>{t('agent.budget')}: {run.modelTurns}/{run.budget.maxModelTurns} · {run.toolCalls}/{run.budget.maxToolCalls}</span>
      {(verification || run.task.verified) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><ShieldCheck size={12} color={isVerified ? 'var(--color-success)' : '#dc2626'} />{isVerified ? t('agent.verified') : t('agent.unverified')}</span>}
    </div>
    {tools.length > 0 && <div style={{ fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--color-text-secondary)', display: 'flex', flexDirection: 'column', gap: '3px' }}>{tools.map((event) => <div key={event.id}>{event.result.ok ? '✓' : '×'} {event.toolCall.function.name}</div>)}</div>}
    {(run.phase === 'interrupted' || run.phase === 'awaiting_user') && onResume && <button className="btn btn-primary" style={{ alignSelf: 'flex-start', fontSize: '12px', padding: '7px 10px' }} onClick={onResume}><RotateCcw size={14} />{t('agent.resume')}</button>}
  </section>;
}
