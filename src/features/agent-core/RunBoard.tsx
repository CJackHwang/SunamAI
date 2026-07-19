import { Activity, CheckCircle2, ChevronDown, Circle, ListTodo, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  const [isExpanded, setIsExpanded] = useState(false);
  useEffect(() => { setIsExpanded(false); }, [run?.id]);
  if (!run) return null;
  const runEvents = projectRunEvents(events, run.id);
  const progress = projectProgress(events, run.id);
  const verification = [...runEvents].reverse().find((event) => event.kind === 'verification');
  const checkpoint = [...runEvents].reverse().find((event) => event.kind === 'checkpoint');
  const isVerified = verification?.passed ?? run.task.verified;
  const tools = runEvents.filter((event) => event.kind === 'tool_finished').slice(-6);
  const completedCount = run.task.plan.filter((item) => item.status === 'completed').length;
  const icon = run.phase === 'failed' ? <XCircle size={16} /> : run.phase === 'completed' ? <CheckCircle2 size={16} /> : run.phase === 'interrupted' ? <Circle size={16} /> : <Activity size={16} />;
  return <section className={`task-list-popover motion-fade-in ${isExpanded ? 'expanded' : ''}`}>
    <button type="button" className="task-list-summary" aria-expanded={isExpanded} onClick={() => setIsExpanded((expanded) => !expanded)}>
      <span className="task-list-icon">{icon}</span>
      <strong>{t('agent.runBoard')}</strong>
      <span className="task-list-count"><ListTodo size={13} />{completedCount}/{run.task.plan.length}</span>
      <span className="task-list-phase">{run.phase}</span>
      <ChevronDown size={16} className="task-list-chevron" />
    </button>
    <div className="task-list-content" aria-hidden={!isExpanded} inert={!isExpanded}>
      <div className="task-list-scroll">
        <div className="task-list-objective">{run.task.objective}</div>
        {run.error && <div style={{ fontSize: '12px', whiteSpace: 'pre-wrap' }}>{run.error}</div>}
        {checkpoint && <div className="task-list-note"><strong>{t('agent.checkpoint')}:</strong> {checkpoint.summary}</div>}
        {(progress || liveOutput) && <div style={{ fontSize: '13px', color: 'var(--color-text)', whiteSpace: 'pre-wrap', maxHeight: '90px', overflowY: 'auto' }}>{progress || liveOutput}</div>}
        {run.task.plan.length > 0 && <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>{run.task.plan.map((item) => <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', color: item.status === 'completed' ? 'var(--color-text-secondary)' : 'var(--color-text)' }}>{item.status === 'completed' ? <CheckCircle2 size={14} /> : <Circle size={14} />}{item.title}</div>)}</div>}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', fontSize: '11px', color: 'var(--color-text-secondary)' }}>
          <span>{t('agent.budget')}: {run.modelTurns}/{run.budget.maxModelTurns} · {run.toolCalls}/{run.budget.maxToolCalls}</span>
          {(verification || run.task.verified) && <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}><ShieldCheck size={12} />{isVerified ? t('agent.verified') : t('agent.unverified')}</span>}
        </div>
        {tools.length > 0 && <details className="task-list-tools"><summary>{tools.length} {t('agent.toolOutputs')}</summary><div>{tools.map((event) => <div key={event.id} className="task-list-tool"><div>{event.result.ok ? '✓' : '×'} {event.toolCall.function.name}</div><pre>{event.result.content.slice(0, 600)}</pre></div>)}</div></details>}
        {run.task.evidence.length > 0 && <div style={{ fontSize: '11px', color: 'var(--color-text-secondary)' }}><strong>{t('agent.evidence')}:</strong> {run.task.evidence.slice(-3).join(' · ')}</div>}
        {(run.phase === 'interrupted' || run.phase === 'awaiting_user') && onResume && <button className="btn btn-primary task-list-resume" onClick={onResume}><RotateCcw size={14} />{t('agent.resume')}</button>}
      </div>
    </div>
  </section>;
}
