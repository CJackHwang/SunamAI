import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type MouseEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Bot, ChevronDown, History, Loader2, MoreHorizontal, Pin, Trash2 } from 'lucide-react';
import type { AgentController, AgentConversationView } from '@/features/agent-core/useAgentV2';
import { isActiveAgentPhase, normalizeSubagentRole, type AgentRun } from '@/features/agent-core/types';
import type { Session } from '@/entities/workspace/types';
import { useIntrinsicDisclosure } from '@/shared/ui/useIntrinsicDisclosure';
import { usePresence } from '@/shared/ui/usePresence';

interface SessionHistoryListProps {
  sessions: Session[];
  activeSessionId: string | null;
  conversationView: AgentConversationView;
  agent: AgentController;
  generatingId: string | null;
  editing: { id: string; text: string } | null;
  editInputRef: RefObject<HTMLInputElement | null>;
  emptyLabel: string;
  deleteLabel: string;
  onSelectSession: (id: string) => void;
  onConversationViewChange: (view: AgentConversationView) => void;
  onOpenSessionContext: (event: MouseEvent, id: string) => void;
  onEditChange: (id: string, text: string) => void;
  onEditSubmit: () => void;
}

interface ChildMenu { run: AgentRun; sessionId: string; x: number; y: number; }

function SubagentContextMenu({ menu, deleteLabel, onClose, onDelete }: { menu: ChildMenu | null; deleteLabel: string; onClose: () => void; onDelete: (menu: ChildMenu) => void }) {
  const { presentValue, isExiting } = usePresence(menu, 240);
  const lastMenu = useRef(menu);
  if (menu) lastMenu.current = menu;
  if (!presentValue || !lastMenu.current) return null;
  const position = { '--context-menu-x': `${presentValue.x}px`, '--context-menu-y': `${presentValue.y}px` } as CSSProperties;
  return createPortal(<><div className={`context-overlay subagent-context-overlay ${isExiting ? 'is-exiting' : ''}`} onClick={onClose} /><div className={`context-menu context-menu-positioned sidebar-context-menu subagent-context-menu ${isExiting ? 'is-exiting' : ''}`} style={position}><button className="context-item danger" onClick={() => onDelete(lastMenu.current!)}><Trash2 size={16} className="context-item-icon" />{deleteLabel}</button></div></>, document.body);
}

function SessionHistoryGroup({ session, activeSessionId, conversationView, childRuns, generatingId, editing, editInputRef, onSelectSession, onConversationViewChange, onOpenSessionContext, onEditChange, onEditSubmit, onOpenChildMenu }: Omit<SessionHistoryListProps, 'sessions' | 'agent' | 'deleteLabel' | 'emptyLabel'> & { session: Session; childRuns: AgentRun[]; onOpenChildMenu: (event: MouseEvent, run: AgentRun, sessionId: string) => void }) {
  const { disclosureRef, toggleDisclosure } = useIntrinsicDisclosure({ contentSelector: '.sidebar-session-children' });
  const isActive = activeSessionId === session.id;
  const isEditing = editing?.id === session.id;
  const hasChildren = childRuns.length > 0;
  const isViewingChild = conversationView.kind === 'subagent' && conversationView.sessionId === session.id;
  const statusIndicator = generatingId === session.id
    ? <Loader2 size={14} className="animate-spin sidebar-generating" />
    : session.status === 'running'
      ? <Loader2 size={14} className="animate-spin sidebar-running" />
      : session.status === 'completed_unread'
        ? <span className="sidebar-status-dot success" />
        : session.status === 'failed_unread'
          ? <span className="sidebar-status-dot danger" />
          : null;
  const selectRoot = () => { onSelectSession(session.id); onConversationViewChange({ kind: 'root' }); };
  const selectRootFromKeyboard = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    selectRoot();
  };
  const selectRootOrToggle = (event: MouseEvent<HTMLElement>) => {
    selectRoot();
    if (isViewingChild) event.preventDefault();
    else toggleDisclosure(event);
  };
  const rowContent = <>
    {session.pinned ? <Pin size={16} fill="currentColor" className="sidebar-resource-icon" /> : <History size={16} className="sidebar-resource-icon" />}
    {isEditing ? <input ref={editInputRef} className="item-text sidebar-item-input" value={editing.text} onChange={(event) => onEditChange(session.id, event.target.value)} onBlur={onEditSubmit} onKeyDown={(event) => event.key === 'Enter' && onEditSubmit()} onClick={(event) => event.stopPropagation()} /> : <span className="item-text">{session.title}</span>}
    {statusIndicator && <span className="sidebar-session-status">{statusIndicator}</span>}
  </>;
  return <div className={`sidebar-session-group ${isActive ? 'active' : ''}`}>
    {hasChildren ? <details ref={disclosureRef} className="sidebar-session-disclosure" data-expanded="false">
      <summary className="sidebar-item list-row sidebar-session-summary" onClick={selectRootOrToggle} onContextMenu={(event) => onOpenSessionContext(event, session.id)}>
        {rowContent}<ChevronDown size={14} className="sidebar-session-chevron" />
      </summary>
      <div className="sidebar-session-children">{childRuns.map((run) => {
        const id = run.delegatedTaskId ?? run.id;
        const selected = conversationView.kind === 'subagent' && conversationView.runId === run.id;
        return <div key={run.id} className={`sidebar-subagent-row list-row ${selected ? 'active' : ''}`} title={id} onClick={() => { onSelectSession(session.id); onConversationViewChange({ kind: 'subagent', sessionId: session.id, runId: run.id }); }} onContextMenu={(event) => onOpenChildMenu(event, run, session.id)}>
          <Bot size={15} />
          <span className="sidebar-subagent-label"><strong>{normalizeSubagentRole(run.agentRole)}</strong><span>{id}</span></span>
          {isActiveAgentPhase(run.phase) ? <Loader2 size={13} className="animate-spin sidebar-running" /> : <span className={`sidebar-status-dot ${run.phase === 'completed' ? 'success' : 'danger'}`} />}
          <button className="item-action" onClick={(event) => { event.stopPropagation(); onOpenChildMenu(event, run, session.id); }} aria-label={id}><MoreHorizontal size={14} /></button>
        </div>;
      })}</div>
    </details> : <div className="sidebar-item list-row sidebar-session-summary sidebar-session-static" role="button" tabIndex={0} onClick={selectRoot} onKeyDown={selectRootFromKeyboard} onContextMenu={(event) => onOpenSessionContext(event, session.id)}>{rowContent}</div>}
    <button className="item-action sidebar-session-action" onClick={(event) => { event.stopPropagation(); onOpenSessionContext(event, session.id); }} aria-label={session.title}><MoreHorizontal size={14} /></button>
  </div>;
}

export function SessionHistoryList(props: SessionHistoryListProps) {
  const [childMenu, setChildMenu] = useState<ChildMenu | null>(null);
  const loadedSessionIdsRef = useRef(new Set<string>());
  const loadSessionSubagents = props.agent.loadSessionSubagents;
  useEffect(() => {
    const visibleSessionIds = new Set(props.sessions.map((session) => session.id));
    for (const sessionId of visibleSessionIds) {
      if (loadedSessionIdsRef.current.has(sessionId)) continue;
      loadedSessionIdsRef.current.add(sessionId);
      void loadSessionSubagents(sessionId);
    }
    for (const sessionId of loadedSessionIdsRef.current) if (!visibleSessionIds.has(sessionId)) loadedSessionIdsRef.current.delete(sessionId);
  }, [loadSessionSubagents, props.sessions]);
  return <><div className="sidebar-list">{props.sessions.length === 0 ? <div className="sidebar-empty">{props.emptyLabel}</div> : props.sessions.map((session) => <SessionHistoryGroup key={session.id} {...props} session={session} childRuns={props.agent.childRunsBySession[session.id] ?? []} onOpenChildMenu={(event, run, sessionId) => { event.preventDefault(); event.stopPropagation(); setChildMenu({ run, sessionId, x: event.clientX, y: event.clientY }); }} />)}</div><SubagentContextMenu menu={childMenu} deleteLabel={props.deleteLabel} onClose={() => setChildMenu(null)} onDelete={(target) => { setChildMenu(null); void props.agent.deleteSubagent(target.sessionId, target.run.id).then((deleted) => { if (deleted && props.conversationView.kind === 'subagent' && props.conversationView.runId === target.run.id) props.onConversationViewChange({ kind: 'root' }); }); }} /></>;
}
