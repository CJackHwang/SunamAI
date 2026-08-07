import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage, CompactionSettings, Entry } from '@earendil-works/pi-agent-core';
import { shouldCompact } from '@earendil-works/pi-agent-core';
import { IndexedDbSessionRepo, deleteIndexedDb } from '@/features/agent-core/pi/indexedDbSessionStorage';
import { PiSession, type PiAgentLike } from '@/features/agent-core/pi/piSession';
import { PI_COMPACTION_RETENTION_RATIO, PI_COMPACTION_TRIGGER_RATIO, buildPiCompactionConfig, isCompactionNeeded, type PiCompactionRunner } from '@/features/agent-core/pi/piCompaction';
import type { AgentEvent, AgentRun } from '@/features/agent-core/types';
import { initialTask } from '@/features/agent-core/task';
import { createChaosContract } from '@/features/agent-core/prompt';

/**
 * P5 pi 上下文压缩测试：
 * - 阈值触发：buildPiCompactionConfig 派生设置与现有 engine.ts 触发点一致；
 * - 压缩真实性：压缩前后 context token 下降 ≥50%；
 * - 压缩后继续：agent 转录重建为摘要 + 保留尾，后续 prompt 正常送达；
 * - 刷新恢复：压缩 entry 持久化后，重建 PiSession 只加载摘要 + 保留尾 + 后续消息（不全量灌入）。
 */

function usage() {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  };
}

function assistantMessage(overrides: Partial<Extract<PiAgentMessage, { role: 'assistant' }>> = {}): Extract<PiAgentMessage, { role: 'assistant' }> {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: '' }],
    api: 'anthropic-messages',
    provider: 'deepseek',
    model: 'deepseek-v4-flash',
    usage: usage(),
    stopReason: 'stop',
    timestamp: 1,
    ...overrides,
  };
}

function createRun(sessionId = 's1', runId = 'r1'): AgentRun {
  const now = Date.now();
  return {
    id: runId,
    sessionId,
    containerId: 'c1',
    model: 'deepseek-v4-flash',
    persona: 'Sunam 6.9 Pron',
    phase: 'preparing',
    createdAt: now,
    updatedAt: now,
    task: initialTask('hello'),
    chaos: createChaosContract('Sunam 6.9 Pron'),
    budget: { maxModelTurns: 1, maxToolCalls: 0, maxDurationMs: 5 * 60_000 },
    modelTurns: 0,
    toolCalls: 0,
    summary: '',
    rootRunId: runId,
    agentRole: 'root',
    depth: 0,
    toolPolicy: { role: 'root', allowedTools: [] },
  };
}

/** 记录 seedHistory 注入的历史，并在 prompt 时按需回放 assistant 回复的假 Agent。 */
class RecordingFakeAgent implements PiAgentLike {
  listener: ((event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>) | null = null;
  seededHistory: PiAgentMessage[] | null = null;
  promptInputs: Array<string | PiAgentMessage> = [];
  onPrompt: ((text: string) => Promise<void>) | null = null;
  private readonly controller = new AbortController();

  subscribe(listener: (event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  async prompt(input: string | PiAgentMessage | PiAgentMessage[]): Promise<void> {
    this.promptInputs.push(typeof input === 'string' ? input : input as PiAgentMessage);
    const text = promptUserText(input);
    await this.onPrompt?.(text);
  }

  abort(): void { this.controller.abort(); }
  waitForIdle(): Promise<void> { return Promise.resolve(); }
  seedHistory(messages: PiAgentMessage[]): void { this.seededHistory = messages; }

  async emit(event: PiAgentEvent): Promise<void> {
    await this.listener?.(event, this.controller.signal);
  }
}

/** 从 pi prompt 入参提取 user 正文（pi 通道以多模态 user 消息投递）。 */
function promptUserText(input: string | PiAgentMessage | PiAgentMessage[]): string {
  if (typeof input === 'string') return input;
  if (Array.isArray(input)) return '';
  if (typeof input !== 'object' || input === null) return '';
  const candidate = input as { role?: unknown; content?: unknown };
  if (candidate.role !== 'user') return '';
  if (typeof candidate.content === 'string') return candidate.content;
  if (Array.isArray(candidate.content)) {
    return candidate.content
      .filter((part): part is { type: 'text'; text: string } => typeof part === 'object' && part !== null && (part as { type?: unknown }).type === 'text' && typeof (part as { text?: unknown }).text === 'string')
      .map((part) => part.text)
      .join('');
  }
  return '';
}

function createAgentWithReply(reply: string): RecordingFakeAgent {
  const agent = new RecordingFakeAgent();
  agent.onPrompt = async () => {
    const message = assistantMessage({ content: [{ type: 'text', text: reply }] });
    await agent.emit({ type: 'agent_start' });
    await agent.emit({ type: 'message_end', message });
    await agent.emit({ type: 'agent_end', messages: [message] });
  };
  return agent;
}

/** 每个测试用独立库名，避免 fake-indexeddb 在同文件内跨测试串扰。 */
const createdDatabases = new Set<string>();
function trackDb(dbName: string): string {
  createdDatabases.add(dbName);
  return dbName;
}

afterEach(async () => {
  for (const dbName of createdDatabases) await deleteIndexedDb(dbName);
  createdDatabases.clear();
});

/** 构造单条 message entry（与 pi 会话持久化形态一致）。 */
function messageEntry(seq: number, role: 'user' | 'assistant', text: string): Entry {
  return {
    type: 'message',
    id: `e${seq}`,
    seq,
    parentId: seq === 1 ? null : `e${seq - 1}`,
    timestamp: seq,
    message: role === 'user'
      ? { role: 'user', content: text, timestamp: seq }
      : assistantMessage({ content: [{ type: 'text', text }] }),
  };
}

describe('P5 压缩阈值对齐（R1）', () => {
  it('派生配置与现有 engine.ts 触发点一致（deepseek 128k profile）', () => {
    const config = buildPiCompactionConfig('deepseek-v4-flash');
    // 现有引擎 effectiveTokens = 128000 - 8192 - 8192 - 4096 = 107520；触发 = floor(0.9 * 107520) = 96768。
    expect(config.contextWindow).toBe(128_000);
    expect(config.profile).toMatchObject({ contextWindowTokens: 128_000 });
    // reserveTokens = contextWindow - trigger + 1，使 pi 严格 > 与引擎 >= 边界对齐。
    expect(config.settings.reserveTokens).toBe(128_000 - 96_768 + 1);
    // 保留量 = floor(effectiveTokens * 0.1) ≈ 10% 上下文（90% 压缩）。
    expect(config.settings.keepRecentTokens).toBe(Math.floor(107_520 * PI_COMPACTION_RETENTION_RATIO));
    // 边界：96767 不触发，96768 触发（与引擎 beforeTokens >= trigger 完全一致）。
    expect(shouldCompact(96_767, config.contextWindow, config.settings)).toBe(false);
    expect(shouldCompact(96_768, config.contextWindow, config.settings)).toBe(true);
    expect(PI_COMPACTION_TRIGGER_RATIO).toBe(0.9);
  });

  it('isCompactionNeeded 按阈值判定（低于不触发，高于触发，空历史不触发）', () => {
    const entries = [
      messageEntry(1, 'user', 'x'.repeat(400)),
      messageEntry(2, 'assistant', 'y'.repeat(400)),
    ];
    const settings: CompactionSettings = { enabled: true, reserveTokens: 850, keepRecentTokens: 50 };
    // tokens ≈ (400+400)/4 = 200；threshold = 1000 - 850 = 150 → 触发。
    expect(shouldCompact(200, 1_000, settings)).toBe(true);
    expect(isCompactionNeeded(entries, 1_000, settings)).toBe(true);
    // threshold = 1000 - 800 = 200 → 200 > 200 为 false（与引擎 >= 对齐后的边界）。
    expect(isCompactionNeeded(entries, 1_000, { ...settings, reserveTokens: 800 })).toBe(false);
    // 空历史不触发。
    expect(isCompactionNeeded([], 1_000, settings)).toBe(false);
    // disabled 不触发。
    expect(isCompactionNeeded(entries, 1_000, { ...settings, enabled: false })).toBe(false);
  });
});

describe('P5 压缩流程（R2 压缩真实性 + 压缩后继续）', () => {
  it('长对话触发压缩，前后 token 下降 ≥50%，后续 prompt 基于压缩上下文继续', async () => {
    const dbName = trackDb('pi-sessions-compaction-flow');
    const repo = new IndexedDbSessionRepo(dbName);
    const session = await repo.create({ id: 's1' });
    // 预置长历史：20 条 message（10 轮），每条 ~14 token，总计 ~280 token。
    for (let i = 1; i <= 10; i += 1) {
      await session.appendMessage({ role: 'user', content: `User message ${i} with enough content to estimate tokens accurately.`, timestamp: i });
      await session.appendMessage(assistantMessage({ content: [{ type: 'text', text: `Assistant reply ${i} continuing the conversation with detail.` }] }));
    }

    const events: AgentEvent[] = [];
    const agent = createAgentWithReply('reply after compaction');
    // 强制触发：reserveTokens 巨大 → 阈值约 0，任何非空历史都压缩；keepRecentTokens 小 → 保留 ~10%。
    const forcedSettings: CompactionSettings = { enabled: true, reserveTokens: 1_000_000, keepRecentTokens: 40 };
    const runner: PiCompactionRunner = async (preparation) => ({
      summary: '## Goal\nFinish the refactor.\n## Progress\n- [x] plan\n- [ ] implement\n## Key Decisions\n- use pi\n## Next Steps\n1. ship\n## Critical Context\n- src/pi',
      tokensBefore: preparation.tokensBefore,
      retainedTail: preparation.retainedTail,
    });
    const piSession = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun('s1', 'r1'),
      onEvent: (event) => events.push(event),
      onRunChange: () => undefined,
      createAgent: () => agent,
      createSessionRepo: () => new IndexedDbSessionRepo(dbName),
      compactionSettings: forcedSettings,
      compactionRunner: runner,
    });
    await piSession.prompt('continue the work');

    // 压缩真实性：压缩前后 context token 显著下降（≥50%）。
    const stats = piSession.lastCompactionStats;
    expect(stats).toBeDefined();
    expect(stats!.beforeTokens).toBeGreaterThan(0);
    expect(stats!.afterTokens).toBeGreaterThan(0);
    expect(stats!.afterTokens).toBeLessThanOrEqual(stats!.beforeTokens / 2);
    expect(stats!.summary).toContain('## Goal');

    // 压缩后继续：agent 转录重建为「摘要 + 保留尾」，且新 prompt 正常送达。
    expect(agent.seededHistory?.[0]?.role).toBe('compactionSummary');
    expect(agent.promptInputs[0]).toMatchObject({ role: 'user', content: 'continue the work' });
    expect(agent.seededHistory!.length).toBeLessThan(20);

    // 压缩过程以 transient 状态事件括起（对齐现有引擎；v3 store 会跳过 transient）。
    const statuses = events.filter((event): event is Extract<AgentEvent, { kind: 'context_compaction_status' }> => event.kind === 'context_compaction_status');
    expect(statuses.some((event) => event.active)).toBe(true);
    expect(statuses.some((event) => !event.active)).toBe(true);

    // 压缩 entry 已持久化到 pi 会话。
    const reopened = await repo.open({ id: 's1', createdAt: 0 });
    const compactionEntries = (await reopened.findEntries({ type: 'compaction', order: 'oldestFirst' })).filter(
      (entry): entry is Extract<typeof entry, { type: 'compaction' }> => entry.type === 'compaction',
    );
    expect(compactionEntries.length).toBe(1);
    expect(compactionEntries[0]!.summary).toContain('## Goal');
    expect(compactionEntries[0]!.retainedTail.length).toBeGreaterThan(0);
    piSession.destroy();
  });

  it('压缩摘要生成失败时跳过压缩并继续对话（不阻断 prompt）', async () => {
    const dbName = trackDb('pi-sessions-compaction-failure');
    const repo = new IndexedDbSessionRepo(dbName);
    const session = await repo.create({ id: 's1' });
    await session.appendMessage({ role: 'user', content: 'x'.repeat(400), timestamp: 1 });
    await session.appendMessage(assistantMessage({ content: [{ type: 'text', text: 'y'.repeat(400) }] }));

    const agent = createAgentWithReply('still works');
    const piSession = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun('s1', 'r1'),
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: () => agent,
      createSessionRepo: () => new IndexedDbSessionRepo(dbName),
      compactionSettings: { enabled: true, reserveTokens: 1_000_000, keepRecentTokens: 40 },
      compactionRunner: async () => { throw new Error('network down'); },
    });
    await piSession.prompt('keep going');

    // 摘要失败 → 跳过压缩：不记录 token 统计，也不重建为压缩上下文。
    expect(piSession.lastCompactionStats).toBeUndefined();
    expect(agent.promptInputs[0]).toMatchObject({ role: 'user', content: 'keep going' });
    // seededHistory 仍是 initialize 阶段注入的预置历史（未发生压缩重建）。
    expect(agent.seededHistory?.length).toBe(2);
    expect(agent.seededHistory?.[0]?.role).toBe('user');
    piSession.destroy();
  });
});

describe('P5 刷新恢复（R4）', () => {
  it('压缩后重建 PiSession 只加载摘要 + 保留尾 + 后续消息，不全量历史', async () => {
    const dbName = trackDb('pi-sessions-compaction-recovery');
    const repo = new IndexedDbSessionRepo(dbName);
    const session = await repo.create({ id: 's1' });
    for (let i = 1; i <= 10; i += 1) {
      await session.appendMessage({ role: 'user', content: `User message ${i} with enough content to estimate tokens accurately.`, timestamp: i });
      await session.appendMessage(assistantMessage({ content: [{ type: 'text', text: `Assistant reply ${i} continuing the conversation with detail.` }] }));
    }

    const runner: PiCompactionRunner = async (preparation) => ({
      summary: '## Goal\nFinish the refactor.\n## Progress\n- [x] plan\n- [ ] implement\n## Critical Context\n- src/pi',
      tokensBefore: preparation.tokensBefore,
      retainedTail: preparation.retainedTail,
    });
    const firstAgent = createAgentWithReply('reply after compaction');
    const first = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r1',
      run: createRun('s1', 'r1'),
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: () => firstAgent,
      createSessionRepo: () => new IndexedDbSessionRepo(dbName),
      compactionSettings: { enabled: true, reserveTokens: 1_000_000, keepRecentTokens: 40 },
      compactionRunner: runner,
    });
    await first.prompt('continue the work');
    const before = first.lastCompactionStats;
    expect(before).toBeDefined();

    // 模拟刷新：全新 PiSession（重建 Agent），会话历史从 IndexedDB 加载并 seed。
    // 关掉压缩，使第二次 prompt 不再次触发压缩，从而观察「压缩后的上下文被正确加载」。
    const secondAgent = createAgentWithReply('reply after refresh');
    const second = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's1',
      runId: 'r2',
      run: createRun('s1', 'r2'),
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: () => secondAgent,
      createSessionRepo: () => new IndexedDbSessionRepo(dbName),
      compactionSettings: { enabled: false, reserveTokens: 0, keepRecentTokens: 0 },
      compactionRunner: runner,
    });
    await second.prompt('second message');

    // 压缩后的上下文正确加载：以 compactionSummary 开头，保留尾 + 后续消息，且不是全量历史。
    const seeded = secondAgent.seededHistory;
    expect(seeded).not.toBeNull();
    const compactionSummary = seeded![0] as Extract<PiAgentMessage, { role: 'compactionSummary' }>;
    expect(compactionSummary.role).toBe('compactionSummary');
    expect(compactionSummary.summary).toContain('## Goal');
    // 20 条预置消息 + 压缩后新增 2 条 = 22 条 message entry；恢复上下文远小于全量。
    expect(seeded!.length).toBeGreaterThan(0);
    expect(seeded!.length).toBeLessThan(22);
    // 压缩后产生的新消息（continue the work）也在恢复上下文里，Agent 可从压缩上下文继续。
    expect(seeded!.some((message) => message.role === 'user' && message.content === 'continue the work')).toBe(true);
    expect(secondAgent.promptInputs[0]).toMatchObject({ role: 'user', content: 'second message' });
    first.destroy();
    second.destroy();
  });
});
