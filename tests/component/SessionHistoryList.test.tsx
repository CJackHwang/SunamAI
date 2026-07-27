import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { AgentController, AgentConversationView } from '@/features/agent-core/useAgentV2';
import type { AgentRun } from '@/features/agent-core/types';
import { SessionHistoryList } from '@/widgets/sidebar/SessionHistoryList';

const child: AgentRun = {
  id: 'child-run', sessionId: 'session', containerId: 'container', model: 'm', persona: 'Sunam 6.9 Pron', phase: 'completed', createdAt: 1, updatedAt: 2,
  task: { objective: 'inspect', acceptanceCriteria: [], constraints: [], requiresPlan: false, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] },
  chaos: { persona: 'Sunam 6.9 Pron', ritual: '', privateGoods: '', styleDirective: '', invariants: [] },
  budget: { maxModelTurns: 20, maxToolCalls: 50, maxDurationMs: 1 }, modelTurns: 1, toolCalls: 1, summary: '', rootRunId: 'root', parentRunId: 'root', depth: 1, agentRole: 'explore', delegatedTaskId: 'task-child-fixed-id',
};

function controller(deleteSubagent = vi.fn(async () => true), loadSessionSubagents = vi.fn(async () => [child])): AgentController {
  return { childRunsBySession: { session: [child] }, deleteSubagent, loadSessionSubagents } as unknown as AgentController;
}

describe('SessionHistoryList', () => {
  it('preloads child presence, expands only a child-bearing session, and selects an immutable child conversation', async () => {
    const user = userEvent.setup();
    const onView = vi.fn<(view: AgentConversationView) => void>();
    const onSelect = vi.fn();
    const onOpenContext = vi.fn();
    const agent = controller();
    render(<SessionHistoryList sessions={[{ id: 'session', title: 'Parent', updatedAt: 1 }]} activeSessionId="session" conversationView={{ kind: 'root' }} agent={agent} generatingId={null} editing={null} editInputRef={createRef()} emptyLabel="Empty" deleteLabel="Delete" onSelectSession={onSelect} onConversationViewChange={onView} onOpenSessionContext={onOpenContext} onEditChange={vi.fn()} onEditSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: 'Parent' }));
    expect(onOpenContext).toHaveBeenCalledWith(expect.anything(), 'session');
    await waitFor(() => expect(agent.loadSessionSubagents).toHaveBeenCalledWith('session'));
    await user.click(screen.getByText('Parent'));
    await user.click(screen.getByText('task-child-fixed-id'));
    expect(onSelect).toHaveBeenLastCalledWith('session');
    expect(onView).toHaveBeenLastCalledWith({ kind: 'subagent', sessionId: 'session', runId: 'child-run' });
    expect(screen.getByText('task-child-fixed-id').closest('.sidebar-subagent-row')).toHaveAttribute('title', 'task-child-fixed-id');
  });

  it('renders a plain aligned history row when the session has no child Runs', async () => {
    const user = userEvent.setup();
    const loadSessionSubagents = vi.fn(async () => []);
    const agent = { ...controller(vi.fn(async () => true), loadSessionSubagents), childRunsBySession: { empty: [] } } as AgentController;
    const onSelect = vi.fn();
    const onView = vi.fn<(view: AgentConversationView) => void>();
    const rendered = render(<SessionHistoryList sessions={[{ id: 'empty', title: 'Plain session', updatedAt: 1 }]} activeSessionId="empty" conversationView={{ kind: 'root' }} agent={agent} generatingId={null} editing={null} editInputRef={createRef()} emptyLabel="Empty" deleteLabel="Delete" onSelectSession={onSelect} onConversationViewChange={onView} onOpenSessionContext={vi.fn()} onEditChange={vi.fn()} onEditSubmit={vi.fn()} />);

    await waitFor(() => expect(loadSessionSubagents).toHaveBeenCalledWith('empty'));
    expect(rendered.container.querySelector('.sidebar-session-disclosure')).not.toBeInTheDocument();
    expect(rendered.container.querySelector('.sidebar-session-chevron')).not.toBeInTheDocument();
    expect(screen.getByText('Plain session').closest('.sidebar-session-static')).toBeInTheDocument();
    await user.click(screen.getByText('Plain session'));
    expect(onSelect).toHaveBeenCalledWith('empty');
    expect(onView).toHaveBeenCalledWith({ kind: 'root' });
  });

  it('renders every session lifecycle state through one fixed status slot', () => {
    const agent = { ...controller(), childRunsBySession: { failed: [] } } as AgentController;
    const baseProps = { sessions: [{ id: 'failed', title: 'Failed session', updatedAt: 1, status: 'failed_unread' as const }], activeSessionId: null, conversationView: { kind: 'root' as const }, agent, generatingId: null, editing: null, editInputRef: createRef<HTMLInputElement>(), emptyLabel: 'Empty', deleteLabel: 'Delete', onSelectSession: vi.fn(), onConversationViewChange: vi.fn(), onOpenSessionContext: vi.fn(), onEditChange: vi.fn(), onEditSubmit: vi.fn() };
    const rendered = render(<SessionHistoryList {...baseProps} />);

    const summary = screen.getByText('Failed session').closest('.sidebar-session-summary')!;
    expect(summary.querySelectorAll('.sidebar-session-status')).toHaveLength(1);
    expect(summary.querySelector('.sidebar-session-status > .sidebar-status-dot.danger')).toBeInTheDocument();
    expect(summary.querySelector(':scope > .sidebar-status-dot')).not.toBeInTheDocument();

    rendered.rerender(<SessionHistoryList {...baseProps} sessions={[{ id: 'failed', title: 'Failed session', updatedAt: 2, status: 'completed_unread' }]} />);
    expect(summary.querySelectorAll('.sidebar-session-status')).toHaveLength(1);
    expect(summary.querySelector('.sidebar-session-status > .sidebar-status-dot.success')).toBeInTheDocument();

    rendered.rerender(<SessionHistoryList {...baseProps} sessions={[{ id: 'failed', title: 'Failed session', updatedAt: 3, status: 'running' }]} />);
    expect(summary.querySelectorAll('.sidebar-session-status')).toHaveLength(1);
    expect(summary.querySelector('.sidebar-session-status > .sidebar-running')).toBeInTheDocument();

    rendered.rerender(<SessionHistoryList {...baseProps} generatingId="failed" sessions={[{ id: 'failed', title: 'Failed session', updatedAt: 4, status: 'idle' }]} />);
    expect(summary.querySelectorAll('.sidebar-session-status')).toHaveLength(1);
    expect(summary.querySelector('.sidebar-session-status > .sidebar-generating')).toBeInTheDocument();
  });

  it('offers only deletion for a child and removes it through the Agent controller', async () => {
    const user = userEvent.setup();
    const deleteSubagent = vi.fn(async () => true);
    const rendered = render(<SessionHistoryList sessions={[{ id: 'session', title: 'Parent', updatedAt: 1 }]} activeSessionId="session" conversationView={{ kind: 'subagent', sessionId: 'session', runId: child.id }} agent={controller(deleteSubagent)} generatingId={null} editing={null} editInputRef={createRef()} emptyLabel="Empty" deleteLabel="Delete" onSelectSession={vi.fn()} onConversationViewChange={vi.fn()} onOpenSessionContext={vi.fn()} onEditChange={vi.fn()} onEditSubmit={vi.fn()} />);
    const view = within(rendered.container);

    await user.click(view.getByRole('button', { name: 'task-child-fixed-id' }));
    expect(rendered.container.querySelector('.context-menu')).not.toBeInTheDocument();
    const menu = document.body.querySelectorAll<HTMLElement>('.sidebar-context-menu').item(document.body.querySelectorAll('.sidebar-context-menu').length - 1);
    expect(menu).toBeInTheDocument();
    expect(within(menu).getByRole('button', { name: 'Delete' })).toBeInTheDocument();
    expect(within(menu).queryByText(/Rename|Pin|Generate/)).not.toBeInTheDocument();
    await user.click(within(menu).getByRole('button', { name: 'Delete' }));
    expect(deleteSubagent).toHaveBeenCalledWith('session', 'child-run');
    rendered.unmount();
  });

  it('keeps the child entry and selected view when durable deletion fails', async () => {
    const user = userEvent.setup();
    const deleteSubagent = vi.fn(async () => false);
    const onView = vi.fn<(view: AgentConversationView) => void>();
    const rendered = render(<SessionHistoryList sessions={[{ id: 'session', title: 'Parent', updatedAt: 1 }]} activeSessionId="session" conversationView={{ kind: 'subagent', sessionId: 'session', runId: child.id }} agent={controller(deleteSubagent)} generatingId={null} editing={null} editInputRef={createRef()} emptyLabel="Empty" deleteLabel="Delete" onSelectSession={vi.fn()} onConversationViewChange={onView} onOpenSessionContext={vi.fn()} onEditChange={vi.fn()} onEditSubmit={vi.fn()} />);
    const view = within(rendered.container);

    await user.click(view.getByRole('button', { name: 'task-child-fixed-id' }));
    const menu = document.body.querySelectorAll<HTMLElement>('.sidebar-context-menu').item(document.body.querySelectorAll('.sidebar-context-menu').length - 1);
    await user.click(within(menu).getByRole('button', { name: 'Delete' }));

    expect(deleteSubagent).toHaveBeenCalledWith('session', 'child-run');
    expect(view.getByText('task-child-fixed-id')).toBeInTheDocument();
    expect(onView).not.toHaveBeenCalled();
    rendered.unmount();
  });

  it('returns from a selected child without collapsing, then toggles from the root view', async () => {
    const user = userEvent.setup();
    const onView = vi.fn<(view: AgentConversationView) => void>();
    const props = { sessions: [{ id: 'session', title: 'Parent', updatedAt: 1 }], activeSessionId: 'session', agent: controller(), generatingId: null, editing: null, editInputRef: createRef<HTMLInputElement>(), emptyLabel: 'Empty', deleteLabel: 'Delete', onSelectSession: vi.fn(), onConversationViewChange: onView, onOpenSessionContext: vi.fn(), onEditChange: vi.fn(), onEditSubmit: vi.fn() };
    const rendered = render(<SessionHistoryList {...props} conversationView={{ kind: 'subagent', sessionId: 'session', runId: child.id }} />);
    const details = rendered.container.querySelector('details')!;
    details.open = true;
    details.dataset.expanded = 'true';

    const view = within(rendered.container);
    await user.click(view.getByText('Parent'));
    expect(onView).toHaveBeenLastCalledWith({ kind: 'root' });
    expect(details).toHaveAttribute('open');
    expect(details).toHaveAttribute('data-expanded', 'true');

    rendered.rerender(<SessionHistoryList {...props} conversationView={{ kind: 'root' }} />);
    await user.click(view.getByText('Parent'));
    expect(details).toHaveAttribute('data-expanded', 'false');
  });

  it('replaces History with Pin and presents legacy child roles as task', () => {
    const legacyChild = { ...child, agentRole: 'implement' as const };
    const agent = { ...controller(), childRunsBySession: { session: [legacyChild] } } as AgentController;
    const rendered = render(<SessionHistoryList sessions={[{ id: 'session', title: 'Pinned parent', updatedAt: 1, pinned: true }]} activeSessionId="session" conversationView={{ kind: 'root' }} agent={agent} generatingId={null} editing={null} editInputRef={createRef()} emptyLabel="Empty" deleteLabel="Delete" onSelectSession={vi.fn()} onConversationViewChange={vi.fn()} onOpenSessionContext={vi.fn()} onEditChange={vi.fn()} onEditSubmit={vi.fn()} />);

    expect(rendered.container.querySelector('.sidebar-session-summary > .lucide-pin')).toBeInTheDocument();
    expect(rendered.container.querySelector('.sidebar-session-summary > .lucide-history')).not.toBeInTheDocument();
    expect(screen.getByText('task')).toBeInTheDocument();
    expect(screen.queryByText('implement')).not.toBeInTheDocument();
  });
});
