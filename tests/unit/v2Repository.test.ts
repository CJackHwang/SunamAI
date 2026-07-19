import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { FileSystemTree } from '@webcontainer/api';
import { parseV2Backup, serializeV2Backup, V2PersistenceRepository, V2_BACKUP_FORMAT_VERSION, V2_PERSISTENCE_DATABASE, V2_PERSISTENCE_VERSION } from '@/shared/persistence/v2Repository';
import type { AgentEvent, AgentRun } from '@/features/agent-core/types';
import type { WorkspaceState } from '@/entities/workspace/types';

const workspace: WorkspaceState = {
  sessions: [{ id: 's-1', title: 'One', updatedAt: 1 }],
  containers: [{ id: 'c-1', name: 'One', updatedAt: 1 }],
  activeSessionId: 's-1',
  activeContainerId: 'c-1',
};

function run(id = 'r-1'): AgentRun {
  return {
    id, sessionId: 's-1', containerId: 'c-1', model: 'model', persona: 'Sunam 1.14 Homo', phase: 'planning', createdAt: 1, updatedAt: 1,
    task: { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: true, plan: [], evidence: [], changedWorkspace: false, verified: false, verificationEvidence: [] },
    chaos: { persona: 'Sunam 1.14 Homo', ritual: 'ritual', privateGoods: 'good', styleDirective: 'style', invariants: [] },
    budget: { maxModelTurns: 4, maxToolCalls: 4, maxDurationMs: 4 }, modelTurns: 0, toolCalls: 0, summary: '',
  };
}

function event(value: AgentRun): AgentEvent {
  return { id: 'r-1:1', kind: 'run_started', sessionId: value.sessionId, runId: value.id, sequence: 1, createdAt: 1, run: value };
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

describe('V2PersistenceRepository', () => {
  let repository: V2PersistenceRepository;

  beforeEach(async () => {
    repository = new V2PersistenceRepository();
    await repository.clearAll();
  });

  it('persists only versioned v2 workspace, ledger, checkpoint, terminal history, and snapshots', async () => {
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

  it('quarantines malformed v2 records instead of silently replacing them', async () => {
    const unsafe = repository as unknown as { put: (store: string, id: string, payload: unknown) => Promise<void> };
    await unsafe.put('runs', 'broken-run', { hello: 'not a run' });
    const result = await repository.listRuns();
    expect(result.value).toEqual([]);
    expect(result.issues).toHaveLength(1);
    const issue = (await repository.listIssues())[0];
    expect(issue?.recordId).toBe('broken-run');
    await repository.clearIssue(issue!.id);
    expect(await repository.listIssues()).toEqual([]);
  });

  it('imports a supported v2 backup without overwriting existing IDs and interrupts active imported runs', async () => {
    await repository.saveWorkspace(workspace);
    const activeRun = run();
    await repository.saveRun(activeRun);
    await repository.appendEvent(event(activeRun));
    const backup = await repository.exportBackup();
    await repository.importBackup(backup);

    const restored = await repository.loadWorkspace();
    expect(restored.value?.sessions).toHaveLength(2);
    expect(restored.value?.sessions.map((session) => session.id)).toContain('s-1');
    const runs = await repository.listRuns();
    expect(runs.value).toHaveLength(2);
    expect(runs.value.find((candidate) => candidate.id !== 'r-1')?.phase).toBe('interrupted');
  });

  it('rejects non-v2 backup formats before writing anything', async () => {
    await expect(repository.importBackup({ formatVersion: 999, payload: {} })).rejects.toThrow('Unsupported v2 backup format');
    expect((await repository.loadWorkspace()).value).toBeNull();
  });

  it('upgrades supported v2 records in place and deletes data by session/container scope', async () => {
    const legacyV2 = run('r-legacy');
    const withoutEvidence = { ...legacyV2, task: { ...legacyV2.task } } as AgentRun & { task: Omit<AgentRun['task'], 'verificationEvidence'> };
    delete (withoutEvidence.task as Partial<AgentRun['task']>).verificationEvidence;
    await putRaw('runs', { id: legacyV2.id, formatVersion: 1, updatedAt: 1, payload: withoutEvidence });
    const upgraded = await repository.loadRun('r-legacy');
    expect(upgraded.value?.task.verificationEvidence).toEqual([]);

    await repository.saveWorkspace(workspace);
    await repository.appendEvent(event(legacyV2));
    await repository.saveCheckpoint({ id: 'cp-delete', runId: legacyV2.id, sessionId: 's-1', containerId: 'c-1', summary: 'x', messages: [], createdAt: 1 });
    await repository.saveTerminalHistory('s-1', 'history');
    await repository.saveSnapshot('c-1', { 'a.txt': { file: { contents: 'a' } } });
    expect((await repository.stats()).records.runs).toBeGreaterThan(0);
    await repository.deleteSession('s-1');
    expect((await repository.listEvents('s-1')).value).toEqual([]);
    expect((await repository.loadTerminalHistory('s-1')).value).toBeNull();
    await repository.deleteContainer('c-1');
    expect((await repository.loadSnapshot('c-1')).value).toBeNull();
  });

  it('round-trips binary snapshots in a portable backup and creates metadata for orphan recovery records', async () => {
    const activeRun = run('r-orphan');
    const binaryTree: FileSystemTree = { 'asset.bin': { file: { contents: new Uint8Array([0, 5, 255]) } } };
    const backup = {
      formatVersion: V2_BACKUP_FORMAT_VERSION,
      exportedAt: 1,
      payload: {
        workspace: null,
        runs: [activeRun],
        events: [event(activeRun)],
        checkpoints: [{ id: 'cp-orphan', runId: activeRun.id, sessionId: activeRun.sessionId, containerId: activeRun.containerId, summary: 'resume', messages: [], createdAt: 1 }],
        terminalHistory: [{ sessionId: activeRun.sessionId, content: 'hello', updatedAt: 1 }],
        snapshots: [{ containerId: activeRun.containerId, tree: binaryTree, updatedAt: 1 }],
      },
    };

    const portable = serializeV2Backup(backup);
    expect(portable).toContain('__sunam_v2_bytes__');
    const parsed = parseV2Backup(portable);
    await repository.importBackup(parsed);
    const restored = await repository.exportBackup();
    const restoredSnapshot = restored.payload.snapshots[0];
    expect(restoredSnapshot).toBeDefined();
    const contents = (restoredSnapshot!.tree['asset.bin'] as { file: { contents: Uint8Array } }).file.contents;
    // fake-indexeddb clones typed arrays from a separate realm, so `instanceof`
    // is intentionally less reliable than the platform's view predicate here.
    expect(ArrayBuffer.isView(contents)).toBe(true);
    expect(Array.from(contents)).toEqual([0, 5, 255]);
    expect(restored.payload.workspace?.sessions).toHaveLength(1);
    expect(restored.payload.workspace?.containers).toHaveLength(1);
    expect(restored.payload.runs[0]?.phase).toBe('interrupted');
  });

  it('keeps transient events out of the durable ledger and validates every imported child record', async () => {
    const activeRun = run();
    await repository.appendEvent({ ...event(activeRun), transient: true });
    expect((await repository.listEvents('s-1')).value).toEqual([]);
    expect((await repository.latestCheckpoint('missing')).value).toBeNull();
    await expect(repository.importBackup({
      formatVersion: V2_BACKUP_FORMAT_VERSION,
      exportedAt: 1,
      payload: { workspace, runs: [], events: [], checkpoints: [], terminalHistory: [{ sessionId: 3, content: 'bad' }], snapshots: [] },
    })).rejects.toThrow('Backup contains malformed v2 records');
  });
});
