import { afterEach, describe, expect, it } from 'vitest';
import type { AgentEvent as PiAgentEvent, AgentMessage as PiAgentMessage } from '@earendil-works/pi-agent-core';
import { createSessionBackendConformance } from '@earendil-works/pi-agent-core/session/testing';
import type { SessionBackendFixture } from '@earendil-works/pi-agent-core/session/testing';
import { IndexedDbSessionRepo, deleteIndexedDb } from '@/features/agent-core/pi/indexedDbSessionStorage';
import { PiSession, type PiAgentLike } from '@/features/agent-core/pi/piSession';
import type { AgentRun } from '@/features/agent-core/types';
import { initialTask } from '@/features/agent-core/task';
import { createChaosContract } from '@/features/agent-core/prompt';

// ---- 测试基建 ----

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
  promptInputs: string[] = [];
  onPrompt: ((text: string) => Promise<void>) | null = null;
  private readonly controller = new AbortController();

  subscribe(listener: (event: PiAgentEvent, signal: AbortSignal) => void | Promise<void>): () => void {
    this.listener = listener;
    return () => { this.listener = null; };
  }

  async prompt(input: string | PiAgentMessage | PiAgentMessage[]): Promise<void> {
    this.promptInputs.push(typeof input === 'string' ? input : JSON.stringify(input));
    await this.onPrompt?.(typeof input === 'string' ? input : '');
  }

  abort(): void { this.controller.abort(); }
  waitForIdle(): Promise<void> { return Promise.resolve(); }
  seedHistory(messages: PiAgentMessage[]): void { this.seededHistory = messages; }

  async emit(event: PiAgentEvent): Promise<void> {
    await this.listener?.(event, this.controller.signal);
  }
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

// 每个测试用独立库名，避免 fake-indexeddb 在同文件内跨测试串扰。
const createdDatabases = new Set<string>();
function trackDb(dbName: string): string {
  createdDatabases.add(dbName);
  return dbName;
}

afterEach(async () => {
  for (const dbName of createdDatabases) await deleteIndexedDb(dbName);
  createdDatabases.clear();
});

// ---- 官方 conformance（pi 提供的自定义后端一致性套件） ----

let fixtureCounter = 0;
async function createFixture(): Promise<SessionBackendFixture> {
  const dbName = trackDb(`pi-sessions-conformance-${fixtureCounter++}`);
  const repository = new IndexedDbSessionRepo(dbName);
  // ES2023 lib 无 Symbol.asyncDispose 类型，运行时存在（Node 22+）；以符号键暴露 asyncDispose。
  const disposeSymbol = (Symbol as unknown as { asyncDispose: symbol }).asyncDispose;
  return {
    repository,
    [disposeSymbol]: async () => {
      await deleteIndexedDb(dbName);
    },
  } as unknown as SessionBackendFixture;
}

const conformanceCases = createSessionBackendConformance(createFixture);

describe('IndexedDbSessionRepo 通过 pi 官方 conformance', () => {
  for (const testCase of conformanceCases) {
    it(`${testCase.group} — ${testCase.name}`, async () => {
      await testCase.run();
    });
  }
});

// ---- IndexedDB 读写往返 ----

describe('IndexedDbSessionRepo 持久化往返', () => {
  it('写→重开→历史完整（mutation 落库后可重放）', async () => {
    const dbName = trackDb('pi-sessions-roundtrip');
    const repo = new IndexedDbSessionRepo(dbName);
    const session = await repo.create({ id: 's1' });
    await session.appendMessage({ role: 'user', content: 'hello', timestamp: 1 });
    await session.appendMessage(assistantMessage({ content: [{ type: 'text', text: 'hi' }] }));
    await session.setName('Roundtrip');

    // 重新打开（模拟刷新）：新 repo、新 storage，从 IndexedDB 重放恢复。
    const reopened = await repo.open({ id: 's1', createdAt: 0 });
    const entries = await reopened.findEntries({ order: 'oldestFirst' });
    expect(entries.map((entry) => (entry.type === 'message' ? entry.message.role : entry.type))).toEqual(['user', 'assistant']);
    const first = entries[0];
    expect(first?.type).toBe('message');
    if (first?.type === 'message') expect(first.message).toMatchObject({ role: 'user', content: 'hello' });
    expect(await reopened.getName()).toBe('Roundtrip');
    expect((await reopened.getStats()).messageCount).toBe(2);
  });

  it('repo 列表：多会话元数据持久', async () => {
    const dbName = trackDb('pi-sessions-list');
    const repo = new IndexedDbSessionRepo(dbName);
    await repo.create({ id: 'a' });
    await repo.create({ id: 'b', parentSessionId: 'a' });
    const listed = await repo.list();
    expect(listed.map((metadata) => metadata.id).sort()).toEqual(['a', 'b']);
    expect(listed.every((metadata) => typeof metadata.createdAt === 'number')).toBe(true);
    expect(listed.find((metadata) => metadata.id === 'b')?.parentSessionId).toBe('a');
  });

  it('删除会话：meta 与 mutation 日志一并移除', async () => {
    const dbName = trackDb('pi-sessions-delete');
    const repo = new IndexedDbSessionRepo(dbName);
    const session = await repo.create({ id: 's1' });
    await session.appendMessage({ role: 'user', content: 'x', timestamp: 1 });
    await repo.delete({ id: 's1', createdAt: 0 });
    await expect(repo.open({ id: 's1', createdAt: 0 })).rejects.toMatchObject({ code: 'not_found' });
    expect(await repo.list()).toEqual([]);
  });
});

// ---- 刷新恢复端到端（R3） ----

describe('PiSession 刷新恢复端到端', () => {
  it('对话记录入 IndexedDB，重建 PiSession 后历史恢复且 Agent 可继续', async () => {
    const dbName = trackDb('pi-sessions-refresh');

    // 第一轮：真实对话流程（mock Agent），消息写入 IndexedDB。
    const firstAgent = createAgentWithReply('first reply');
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
    });
    await first.prompt('hello');

    // 模拟刷新：全新 PiSession（重建 Agent），会话历史从 IndexedDB 加载并 seed。
    const secondAgent = createAgentWithReply('second reply');
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
    });
    await second.prompt('second message');

    // 历史恢复：重建的 Agent 转录 seed 了第一轮完整历史。
    expect(secondAgent.seededHistory?.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect((secondAgent.seededHistory?.[0] as Extract<PiAgentMessage, { role: 'user' }>).content).toBe('hello');
    expect((secondAgent.seededHistory?.[1] as Extract<PiAgentMessage, { role: 'assistant' }>).content).toEqual([{ type: 'text', text: 'first reply' }]);
    // Agent 可从历史继续：第二轮 prompt 正常送达（pi 通道以多模态 user 消息投递，正文含该提示）。
    expect(secondAgent.promptInputs[0]).toContain('second message');

    // 两轮消息全部持久化在 IndexedDB 中。
    const reopened = await new IndexedDbSessionRepo(dbName).open({ id: 's1', createdAt: 0 });
    const messages = (await reopened.findEntries({ type: 'message', order: 'oldestFirst' })).filter(
      (entry): entry is Extract<typeof entry, { type: 'message' }> => entry.type === 'message',
    );
    expect(messages.map((entry) => entry.message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });

  it('resume continues from the persisted session history with a checkpoint-style prompt (R2)', async () => {
    const dbName = trackDb('pi-sessions-resume');

    // 第一轮：断点前的一轮对话（mock Agent），消息写入 IndexedDB。
    const firstAgent = createAgentWithReply('first reply');
    const first = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's-resume',
      runId: 'r1',
      run: createRun('s-resume', 'r1'),
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: () => firstAgent,
      createSessionRepo: () => new IndexedDbSessionRepo(dbName),
    });
    await first.prompt('build the feature');

    // 恢复：同一会话 ID 重建 PiSession，Agent 转录 seed 全部历史，随后从 resume 提示继续。
    const resumeAgent = createAgentWithReply('resumed');
    const resume = new PiSession({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepseek.com/v1',
      apiModel: 'deepseek-v4-flash',
      sessionId: 's-resume',
      runId: 'r2',
      run: createRun('s-resume', 'r2'),
      onEvent: () => undefined,
      onRunChange: () => undefined,
      createAgent: () => resumeAgent,
      createSessionRepo: () => new IndexedDbSessionRepo(dbName),
    });
    const resumePrompt = 'Continue from checkpoint: inspect the current workspace and finish after verification.';
    await resume.prompt(resumePrompt);

    expect(resumeAgent.seededHistory?.map((message) => message.role)).toEqual(['user', 'assistant']);
    expect(resumeAgent.promptInputs[0]).toContain(resumePrompt);
    // 恢复后的消息也追加到同一会话（用户、assistant、resume、assistant）。
    const reopened = await new IndexedDbSessionRepo(dbName).open({ id: 's-resume', createdAt: 0 });
    const messages = (await reopened.findEntries({ type: 'message', order: 'oldestFirst' })).filter(
      (entry): entry is Extract<typeof entry, { type: 'message' }> => entry.type === 'message',
    );
    expect(messages.map((entry) => entry.message.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
  });
});
