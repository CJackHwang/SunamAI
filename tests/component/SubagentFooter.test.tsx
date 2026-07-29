import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SubagentFooter } from '@/features/chat/ui/SubagentFooter';
import { I18nProvider } from '@/shared/i18n';
import { RunBoard } from '@/features/agent-core/RunBoard';
import type { AgentRun } from '@/features/agent-core/types';

describe('SubagentFooter', () => {
  it('exposes only the individual child stop action while running', async () => {
    const user = userEvent.setup();
    const onStop = vi.fn();
    const { container } = render(<I18nProvider><SubagentFooter isRunning isAtBottom onStop={onStop} onReturn={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    await user.click(screen.getByRole('button', { name: '停止此子 Agent' }));
    expect(onStop).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '返回父 Agent' })).not.toBeInTheDocument();
    expect(container.querySelector('textarea, input[type="file"], .task-list-popover')).toBeNull();
  });

  it('replaces stop with return after the child reaches a terminal state', async () => {
    const user = userEvent.setup();
    const onReturn = vi.fn();
    const rendered = render(<I18nProvider><SubagentFooter isRunning={false} isAtBottom onStop={vi.fn()} onReturn={onReturn} onScrollToBottom={vi.fn()} /></I18nProvider>);
    const view = within(rendered.container);
    await user.click(view.getByRole('button', { name: '返回父 Agent' }));
    expect(onReturn).toHaveBeenCalledOnce();
    expect(view.queryByRole('button', { name: '停止此子 Agent' })).not.toBeInTheDocument();
  });

  it('shows an isolated child plan without restoring child input controls', async () => {
    const user = userEvent.setup();
    const child: AgentRun = {
      id: 'child-plan', sessionId: 'session', containerId: 'container', model: 'model', persona: 'Sunam 6.9 Pron', phase: 'acting', createdAt: 1, updatedAt: 1,
      task: { objective: 'Child-only objective', acceptanceCriteria: [], constraints: [], requiresPlan: true, plan: [{ id: 'child-step', title: 'Child-only step', status: 'in_progress' }], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] },
      chaos: { persona: 'Sunam 6.9 Pron', ritual: '', privateGoods: '', styleDirective: '', invariants: [] },
      budget: { maxModelTurns: 20, maxToolCalls: 50, maxDurationMs: 300_000 }, modelTurns: 1, toolCalls: 1, summary: '', rootRunId: 'root', parentRunId: 'root', agentRole: 'task', depth: 1,
    };
    const rendered = render(<I18nProvider><SubagentFooter isRunning isAtBottom taskList={<RunBoard run={child} events={[]} />} onStop={vi.fn()} onReturn={vi.fn()} onScrollToBottom={vi.fn()} /></I18nProvider>);
    const view = within(rendered.container);
    await user.click(view.getByRole('button', { name: /任务列表/ }));
    expect(view.getByText('Child-only step')).toBeInTheDocument();
    expect(rendered.container.querySelector('textarea, input[type="file"]')).toBeNull();
  });
});
