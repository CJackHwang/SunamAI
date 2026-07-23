import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FileSystemTree } from '@webcontainer/api';
import { V2PersistenceRepository, V2_PERSISTENCE_DATABASE, V2_PERSISTENCE_VERSION } from '@/shared/persistence/v2Repository';
import type { AgentEvent, AgentRun } from '@/features/agent-core/types';
import type { WorkspaceState } from '@/entities/workspace/types';
import { clearV2Database } from '../helpers/v2Database';

const workspace: WorkspaceState = { sessions: [{ id: 's-1', title: 'One', updatedAt: 1 }], containers: [{ id: 'c-1', name: 'One', updatedAt: 1 }], activeSessionId: 's-1', activeContainerId: 'c-1' };

function run(id = 'r-1'): AgentRun {
  return {
    id, sessionId: 's-1', containerId: 'c-1', model: 'model', persona: 'Sunam 6.9 Pron', phase: 'planning', createdAt: 1, updatedAt: 1,
    task: { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: true, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] },
    chaos: { persona: 'Sunam 6.9 Pron', styleDirective: 'style', invariants: [] },
    budget: { maxModelTurns: 4, maxToolCalls: 4, maxDurationMs: 4 }, modelTurns: 0, toolCalls: 0, summary: '',
  };
}

function event(value: AgentRun): AgentEvent {
  return { id: `${value.id}:1`, kind: 'run_started', sessionId: value.sessionId, runId: value.id, sequence: 1, createdAt: 1, run: value };
}

async function putRaw(storeName: string, value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(V2_PERSISTENCE_DATABASE, V2_PERSISTENCE_VERSION);
    request.onsuccess = () => {
      const transaction = request.result.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(value);
      transaction.oncomplete = () => { request.result.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

async function getRaw(storeName: string, id: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(V2_PERSISTENCE_DATABASE, V2_PERSISTENCE_VERSION);
    request.onsuccess = () => {
      const transaction = request.result.transaction(storeName, 'readonly');
      const read = transaction.objectStore(storeName).get(id);
      read.onsuccess = () => { request.result.close(); resolve(read.result); };
      read.onerror = () => reject(read.error);
    };
    request.onerror = () => reject(request.error);
  });
}

describe('V2PersistenceRepository', () => {
  let repository: V2PersistenceRepository;
  beforeEach(async () => { await clearV2Database(); repository = new V2PersistenceRepository(); });

  it('persists the online v2 workspace records', async () => {
    const activeRun = run();
    const tree: FileSystemTree = { 'demo.txt': { file: { contents: 'hello' } } };
    await repository.saveWorkspace(workspace);
    await repository.saveRun(activeRun);
    await repository.appendEvent(event(activeRun));
    await repository.saveCheckpoint({ id: 'cp-1', runId: activeRun.id, sessionId: 's-1', containerId: 'c-1', summary: 'checkpoint', messages: [{ role: 'user', content: 'hello' }], createdAt: 2 });
    await repository.saveTerminalHistory('s-1', 'terminal output');
    await repository.saveSnapshot('c-1', tree);
    expect((await repository.loadWorkspace()).value).toEqual(workspace);
    expect((await repository.listRuns('s-1')).value).toHaveLength(1);
    expect((await repository.listEvents('s-1')).value).toEqual([event(activeRun)]);
    expect((await repository.latestCheckpoint('r-1')).value?.summary).toBe('checkpoint');
    expect((await repository.loadTerminalHistory('s-1')).value).toBe('terminal output');
    expect((await repository.loadSnapshot('c-1')).value).toEqual(tree);
  });

  it('reuses one IndexedDB connection across repository operations', async () => {
    const open = vi.spyOn(indexedDB, 'open');
    await repository.saveWorkspace(workspace);
    await repository.loadWorkspace();
    await repository.listRuns('s-1');
    expect(open).toHaveBeenCalledTimes(1);
    open.mockRestore();
  });

  it('quarantines each malformed record once', async () => {
    await repository.loadWorkspace();
    await putRaw('runs', { id: 'broken-run', formatVersion: V2_PERSISTENCE_VERSION, updatedAt: 1, payload: { hello: 'not a run' } });
    expect((await repository.listRuns()).issues).toHaveLength(1);
    expect((await repository.listRuns()).issues).toHaveLength(1);
    const issues = await repository.listIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.recordId).toBe('broken-run');
  });

  it('upgrades supported records and deletes data by scope', async () => {
    await repository.loadWorkspace();
    const legacy = run('r-legacy');
    const payload = { ...legacy, task: { ...legacy.task } };
    delete (payload.task as Partial<AgentRun['task']>).verificationEvidence;
    delete (payload.task as Partial<AgentRun['task']>).workspaceRevision;
    delete (payload.task as Partial<AgentRun['task']>).verifiedRevision;
    await putRaw('runs', { id: legacy.id, formatVersion: 1, updatedAt: 1, payload });
    expect((await repository.loadRun(legacy.id)).value?.task.verificationEvidence).toEqual([]);
    expect((await repository.loadRun(legacy.id)).value?.task).toMatchObject({ workspaceRevision: 0, verifiedRevision: -1 });
    await repository.appendEvent(event(legacy));
    await repository.saveCheckpoint({ id: 'cp-delete', runId: legacy.id, sessionId: 's-1', containerId: 'c-1', summary: 'x', messages: [], createdAt: 1 });
    await repository.saveTerminalHistory('s-1', 'history');
    await repository.saveSnapshot('c-1', { 'a.txt': { file: { contents: 'a' } } });
    await repository.deleteSession('s-1');
    expect((await repository.listRuns('s-1')).value).toEqual([]);
    expect((await repository.listEvents('s-1')).value).toEqual([]);
    expect((await repository.latestCheckpoint(legacy.id)).value).toBeNull();
    expect((await repository.loadTerminalHistory('s-1')).value).toBeNull();

    const containerRun = run('r-container-delete');
    await repository.saveRun(containerRun);
    await repository.appendEvent(event(containerRun));
    await repository.saveCheckpoint({ id: 'cp-container-delete', runId: containerRun.id, sessionId: 's-1', containerId: 'c-1', summary: 'x', messages: [], createdAt: 2 });
    await repository.deleteContainer('c-1');
    expect((await repository.loadRun(containerRun.id)).value).toBeNull();
    expect((await repository.listEvents('s-1')).value).toEqual([]);
    expect((await repository.latestCheckpoint(containerRun.id)).value).toBeNull();
    expect((await repository.loadSnapshot('c-1')).value).toBeNull();
  });

  it('persists normalized fields for same-version records and quarantines malformed nested payloads', async () => {
    await repository.loadWorkspace();
    const legacy = run('r-v2-legacy');
    const payload = { ...legacy, task: { ...legacy.task } };
    delete (payload.task as Partial<AgentRun['task']>).workspaceRevision;
    delete (payload.task as Partial<AgentRun['task']>).verifiedRevision;
    await putRaw('runs', { id: legacy.id, formatVersion: V2_PERSISTENCE_VERSION, updatedAt: 1, payload });
    expect((await repository.loadRun(legacy.id)).value?.task).toMatchObject({ workspaceRevision: 0, verifiedRevision: -1 });
    expect((await getRaw('runs', legacy.id) as { payload: AgentRun }).payload.task).toMatchObject({ workspaceRevision: 0, verifiedRevision: -1 });

    await putRaw('events', { id: 'bad-event', formatVersion: V2_PERSISTENCE_VERSION, updatedAt: 2, payload: { id: 'bad-event', kind: 'message', sessionId: 's-1', runId: legacy.id, sequence: 1, createdAt: 2 } });
    const events = await repository.listEvents('s-1');
    expect(events.value).toEqual([]);
    expect(events.issues).toHaveLength(1);
  });

  it('keeps transient events out of the durable ledger', async () => {
    const activeRun = run();
    await repository.appendEvent({ ...event(activeRun), transient: true });
    expect((await repository.listEvents('s-1')).value).toEqual([]);
    expect((await repository.latestCheckpoint('missing')).value).toBeNull();
  });
});
