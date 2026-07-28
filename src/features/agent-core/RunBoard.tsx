import { Activity, Bot, CheckCircle2, ChevronDown, Circle, ListTodo, Minimize2, RotateCcw, ShieldCheck, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/shared/i18n';
import { useIntrinsicDisclosure } from '@/shared/ui/useIntrinsicDisclosure';
import { projectMessages, projectProgress, projectRunEvents } from './projector';
import { normalizeSubagentRole, type AgentEvent, type AgentRun } from './types';

interface RunBoardProps {
  run: AgentRun | null;
  events: AgentEvent[];
  runs?: AgentRun[];
  liveOutput?: string;
  onResume?: () => void;
  onLoadRunEvents?: (runId: string) => void | Promise<void>;
}

function RunBoardDisclosure({ className, summary, children, onOpen }: { className: string; summary: React.ReactNode; children: React.ReactNode; onOpen?: () => void }) {
  const { disclosureRef, toggleDisclosure } = useIntrinsicDisclosure({ contentSelector: '.task-list-disclosure-body', scrollContainerSelector: '.task-list-scroll', ...(onOpen ? { onOpen } : {}) });
  return <details ref={disclosureRef} className={className} data-expanded="false"><summary onClick={toggleDisclosure}>{summary}<ChevronDown size={14} className="task-list-disclosure-chevron" /></summary><div className="task-list-disclosure-body">{children}</div></details>;
}

export function RunBoard({ run, runs = [], events, liveOutput, onResume, onLoadRunEvents }: RunBoardProps) {
  const { t } = useI18n();
  const [isExpanded, setIsExpanded] = useState(false);
  const loadedChildRuns = useRef(new Set<string>());
  const loadingChildRuns = useRef(new Set<string>());
  useEffect(() => { setIsExpanded(false); loadedChildRuns.current.clear(); loadingChildRuns.current.clear(); }, [run?.id]);
  if (!run) return null;
  const runEvents = projectRunEvents(events, run.id);
  const progress = projectProgress(events, run.id);
  const checkpoint = [...runEvents].reverse().find((event) => event.kind === 'checkpoint');
  const compaction = [...runEvents].reverse().find((event) => event.kind === 'context_compacted');
  const isVerified = run.task.verified && run.task.verifiedRevision === run.task.workspaceRevision;
  const tools = runEvents.filter((event) => event.kind === 'tool_finished').slice(-6);
  const completedCount = run.task.plan.filter((item) => item.status === 'completed').length;
  const children = runs.filter((candidate) => candidate.parentRunId === run.id && (candidate.depth ?? 0) === 1).sort((left, right) => left.createdAt - right.createdAt);
  const icon = run.phase === 'failed' ? <XCircle size={16} /> : run.phase === 'completed' ? <CheckCircle2 size={16} /> : run.phase === 'interrupted' ? <Circle size={16} /> : <Activity size={16} />;
  return <section className={`task-list-popover glass-input motion-fade-in ${isExpanded ? 'expanded' : ''}`}>
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
        {run.error && <div className="task-list-error">{run.error}</div>}
        {checkpoint && <RunBoardDisclosure className="task-list-note" summary={<strong>{t('agent.checkpoint')}</strong>}><p>{checkpoint.summary}</p></RunBoardDisclosure>}
        {compaction && <div className="task-list-compaction"><Minimize2 size={13} /><span><strong>{t('agent.contextCompacted')}</strong>{compaction.beforeTokens !== undefined && compaction.afterTokens !== undefined ? ` · ${compaction.beforeTokens} → ${compaction.afterTokens} tokens` : ''}{compaction.fallback ? ` · ${t('agent.deterministicFallback')}` : ''}</span></div>}
        {(progress || liveOutput) && <div className="task-list-progress">{progress || liveOutput}</div>}
        {run.task.plan.length > 0 && <div className="task-list-plan">{run.task.plan.map((item) => <div key={item.id} className={`task-list-plan-item ${item.status === 'completed' ? 'completed' : ''}`}>{item.status === 'completed' ? <CheckCircle2 size={14} /> : <Circle size={14} />}{item.title}</div>)}</div>}
        {children.length > 0 && <div className="task-list-subagents">{children.map((child) => {
          const childEvents = projectRunEvents(events, child.id);
          const childTools = childEvents.filter((event) => event.kind === 'tool_finished');
          const transcript = projectMessages(childEvents).filter((message) => message.content.trim()).slice(-8);
          return <RunBoardDisclosure key={child.id} className="task-list-subagent" onOpen={() => {
            if (loadedChildRuns.current.has(child.id) || loadingChildRuns.current.has(child.id)) return;
            loadingChildRuns.current.add(child.id);
            void Promise.resolve(onLoadRunEvents?.(child.id)).then(() => loadedChildRuns.current.add(child.id), () => undefined).finally(() => loadingChildRuns.current.delete(child.id));
          }} summary={<><Bot size={14} /><strong>{normalizeSubagentRole(child.agentRole)}</strong><span>{child.phase}</span><small>{child.delegatedTaskId}</small></>}><p>{child.finalSummary || child.summary || child.task.objective}</p>{child.task.evidence.length > 0 && <p>{child.task.evidence.slice(-3).join(' · ')}</p>}<small>{child.modelTurns}/{child.budget.maxModelTurns} turns · {child.toolCalls}/{child.budget.maxToolCalls} tools · {childTools.length} records</small>{transcript.length > 0 && <div className="task-list-subagent-transcript"><strong>{t('agent.transcript')}</strong>{transcript.map((message, index) => <div key={`${message.role}:${message.tool_call_id ?? index}`}><span>{message.name || message.role}</span><pre>{message.content.slice(0, 600)}</pre></div>)}</div>}</RunBoardDisclosure>;
        })}</div>}
        <div className="task-list-metadata">
          <span>{t('agent.budget')}: {run.modelTurns}/{run.budget.maxModelTurns} · {run.toolCalls}/{run.budget.maxToolCalls}</span>
          {isVerified && <span className="task-list-verification"><ShieldCheck size={12} />{t('agent.verified')}</span>}
        </div>
        {tools.length > 0 && <RunBoardDisclosure className="task-list-tools" summary={<>{tools.length} {t('agent.toolOutputs')}</>}><div>{tools.map((event) => <div key={event.id} className="task-list-tool"><div>{event.result.ok ? '✓' : '×'} {event.toolCall.function.name}</div><pre>{event.result.content.slice(0, 600)}</pre></div>)}</div></RunBoardDisclosure>}
        {run.task.evidence.length > 0 && <div className="task-list-evidence"><strong>{t('agent.evidence')}:</strong> {run.task.evidence.slice(-3).join(' · ')}</div>}
        {(run.phase === 'interrupted' || run.phase === 'awaiting_user') && onResume && <button className="btn btn-primary task-list-resume" onClick={onResume}><RotateCcw size={14} />{t('agent.resume')}</button>}
      </div>
    </div>
  </section>;
}
