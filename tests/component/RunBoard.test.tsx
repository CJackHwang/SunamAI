import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/shared/i18n';
import { RunBoard } from '@/features/agent-core/RunBoard';
import type { AgentRun } from '@/features/agent-core/types';

const interruptedRun: AgentRun = {
  id: 'r-1', sessionId: 's-1', containerId: 'c-1', model: 'm', persona: 'Sunam 1.14 Homo', phase: 'interrupted', createdAt: 1, updatedAt: 1,
  task: { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: true, plan: [{ id: 'one', title: 'Inspect the dumpster fire', status: 'completed' }], evidence: [], changedWorkspace: true, verified: true, verificationEvidence: [] },
  chaos: { persona: 'Sunam 1.14 Homo', ritual: '命名严肃到荒谬的验收仪式', privateGoods: '彩蛋', styleDirective: 'style', invariants: [] },
  budget: { maxModelTurns: 40, maxToolCalls: 100, maxDurationMs: 1 }, modelTurns: 2, toolCalls: 3, summary: '', error: 'Browser session ended.',
};

describe('RunBoard', () => {
  it('surfaces an interrupted Run, proof state, and checkpoint resume action', async () => {
    const user = userEvent.setup();
    const onResume = vi.fn();
    render(<I18nProvider><RunBoard run={interruptedRun} events={[]} onResume={onResume} /></I18nProvider>);
    const summary = screen.getByRole('button', { name: /任务列表/ });
    expect(summary).toHaveAttribute('aria-expanded', 'false');
    await user.click(summary);
    expect(summary).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Browser session ended.')).toBeInTheDocument();
    expect(screen.getByText('已验收')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '从断点继续折腾' }));
    expect(onResume).toHaveBeenCalledOnce();
  });
});
