import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { Blob as NodeBlob } from 'node:buffer';
import type { AgentEvent, AgentRun } from '@/entities/agent/types';
import type { WorkspaceState } from '@/entities/workspace/types';
import { SNAPSHOT_MAX_BYTES, SNAPSHOT_MAX_FILES, SnapshotLimitError, V3PersistenceRepository, V3_PERSISTENCE_DATABASE, V3_PERSISTENCE_VERSION, sanitizeSnapshotTree } from '@/entities/persistence/v3Repository';
import { clearLegacyV2Database, clearV3Database, readLegacyV2Workspace, seedLegacyV2Workspace } from '../helpers/persistenceDatabase';

const workspace: WorkspaceState = { sessions: [{ id: 's-1', title: 'One', updatedAt: 1 }], containers: [{ id: 'c-1', name: 'One', updatedAt: 1 }], activeSessionId: 's-1', activeContainerId: 'c-1' };

function run(id = 'r-1'): AgentRun {
  return {
    id, sessionId: 's-1', containerId: 'c-1', model: 'model', persona: 'Sunam 6.9 Pron', phase: 'planning', createdAt: 1, updatedAt: 1,
    task: { objective: 'work', acceptanceCriteria: [], constraints: [], requiresPlan: true, plan: [], evidence: [], changedWorkspace: false, workspaceRevision: 0, verified: false, verifiedRevision: -1, verificationEvidence: [] },
    chaos: { persona: 'Sunam 6.9 Pron', ritual: '', privateGoods: '', styleDirective: '', invariants: [] },
    budget: { maxModelTurns: 4, maxToolCalls: 4, maxDurationMs: 4 }, modelTurns: 0, toolCalls: 0, summary: '', rootRunId: id, agentRole: 'root', depth: 0,
  };
}

function messageEvent(sequence: number): AgentEvent {
  return { id: `r-1:${sequence}`, kind: 'message', sessionId: 's-1', runId: 'r-1', sequence, createdAt: sequence, message: { role: 'user', content: `message ${sequence}` } };
}

async function putRaw(storeName: string, value: unknown): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(V3_PERSISTENCE_DATABASE, V3_PERSISTENCE_VERSION);
    request.onsuccess = () => {
      const transaction = request.result.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put(value);
      transaction.oncomplete = () => { request.result.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  });
}

describe('V3PersistenceRepository', () => {
  let repository: V3PersistenceRepository;
  beforeEach(async () => { await clearV3Database(); repository = new V3PersistenceRepository(); });

  it('keeps v2 isolated and starts v3 with a fresh workspace', async () => {
    await clearLegacyV2Database();
    await seedLegacyV2Workspace(workspace);
    expect((await repository.loadWorkspace()).value).toBeNull();
    expect(await readLegacyV2Workspace()).toEqual(workspace);
  });

  it('overwrites one checkpoint per run and pages only the latest 250 events', async () => {
    await repository.saveRun(run());
    for (let sequence = 1; sequence <= 300; sequence += 1) await repository.appendEvent(messageEvent(sequence));
    await repository.saveCheckpoint({ id: 'old-random-id', runId: 'r-1', sessionId: 's-1', containerId: 'c-1', summary: 'first', messages: [], createdAt: 1, eventTailSequence: 1, workspaceRevision: 0 });
    await repository.saveCheckpoint({ id: 'another-id', runId: 'r-1', sessionId: 's-1', containerId: 'c-1', summary: 'latest', messages: [{ role: 'user', content: 'recent only' }], createdAt: 2, eventTailSequence: 300, workspaceRevision: 0 });
    const page = await repository.listEventPage('s-1');
    expect(page.value).toHaveLength(250);
    expect(page.value[0]?.sequence).toBe(51);
    expect(page.hasMore).toBe(true);
    const runPage = await repository.listRunEventPage('r-1');
    expect(runPage.value).toHaveLength(250);
    expect(runPage.value[0]?.sequence).toBe(51);
    expect(runPage.newestSequence).toBe(300);
    expect(runPage.hasMore).toBe(true);
    expect(await repository.countCheckpoints()).toBe(1);
    expect(await repository.latestCheckpoint('r-1')).toMatchObject({ value: { id: 'r-1', summary: 'latest', eventTailSequence: 300 } });
    expect(await repository.latestEventSequence('r-1')).toBe(300);
  });

  it('pages events with identical timestamps without gaps or duplicates', async () => {
    const events = Array.from({ length: 260 }, (_, index): AgentEvent => ({
      id: `same-time-${String(index).padStart(3, '0')}`,
      kind: 'message',
      sessionId: 's-1',
      runId: `run-${index % 3}`,
      sequence: Math.floor(index / 3) + 1,
      createdAt: 100,
      message: { role: 'user', content: String(index) },
    }));
    for (const event of events) await repository.appendEvent(event);
    const latest = await repository.listEventPage('s-1');
    const oldest = latest.value[0]!;
    const previous = await repository.listEventPage('s-1', { before: { createdAt: oldest.createdAt, sequence: oldest.sequence, id: oldest.id } });
    const ids = [...previous.value, ...latest.value].map((event) => event.id);
    expect(ids).toHaveLength(260);
    expect(new Set(ids)).toHaveLength(260);
  });

  it('stores resource blobs separately and transactionally removes all session data with workspace metadata', async () => {
    await repository.saveWorkspace(workspace);
    await repository.saveRun(run());
    await repository.appendEvent({ id: 'r-1:1', kind: 'message', sessionId: 's-1', runId: 'r-1', sequence: 1, createdAt: 1, message: { role: 'user', content: 'inspect resource', contentParts: [{ type: 'file_resource', resourceId: 'res-1' }], resourceIds: ['res-1'] } });
    await repository.saveCheckpoint({ id: 'r-1', runId: 'r-1', sessionId: 's-1', containerId: 'c-1', summary: '', messages: [{ role: 'user', content: 'inspect resource', contentParts: [{ type: 'file_resource', resourceId: 'res-1' }], resourceIds: ['res-1'] }], resourceIds: ['res-1'], createdAt: 1 });
    await repository.saveTerminalHistory('s-1', 'terminal');
    await repository.saveResource({ id: 'res-1', sessionId: 's-1', originatingRunId: 'r-1', name: 'note.txt', kind: 'text', mimeType: 'text/plain', size: 5, sha256: 'abc', createdAt: 1, blob: new Blob(['hello']) });
    expect(JSON.stringify((await repository.listEvents('s-1')).value)).not.toContain('hello');
    expect(JSON.stringify((await repository.latestCheckpoint('r-1')).value)).not.toContain('hello');
    expect(JSON.stringify((await repository.latestCheckpoint('r-1')).value)).not.toContain('base64');
    const next = { ...workspace, sessions: [], activeSessionId: null };
    await repository.deleteSession('s-1', next);
    expect((await repository.loadWorkspace()).value).toEqual(next);
    expect((await repository.listRuns('s-1')).value).toEqual([]);
    expect((await repository.listEvents('s-1')).value).toEqual([]);
    expect((await repository.listResources('s-1')).value).toEqual([]);
    expect((await repository.loadTerminalHistory('s-1')).value).toBeNull();
  });

  it('removes resource bodies and encoded payloads at the persistence boundary', async () => {
    await repository.appendEvent({
      id: 'r-1:1', kind: 'tool_finished', sessionId: 's-1', runId: 'r-1', sequence: 1, createdAt: 1,
      toolCall: { id: 'call-1', type: 'function', function: { name: 'read_resource_text', arguments: JSON.stringify({ resource_id: 'res-1', payload: `data:text/plain;base64,${'A'.repeat(900)}` }) } },
      result: { ok: true, content: 'private attachment text', data: { blob: new Blob(['private attachment text']) }, resourceReferences: ['res-1'] },
    });
    await repository.saveCheckpoint({
      id: 'r-1', runId: 'r-1', sessionId: 's-1', containerId: 'c-1', summary: `data:text/plain;base64,${'B'.repeat(900)}`,
      messages: [{ role: 'tool', name: 'read_resource_text', tool_call_id: 'call-1', content: 'private attachment text', resourceIds: ['res-1'], _ui_attachments: [{ name: 'secret.txt', size: 1, file: new File(['secret'], 'secret.txt') }] }],
      createdAt: 1,
    });
    const event = (await repository.listEvents('s-1')).value[0];
    const checkpoint = (await repository.latestCheckpoint('r-1')).value;
    expect(JSON.stringify(event)).not.toContain('private attachment text');
    expect(JSON.stringify(event)).not.toContain('data:text/plain;base64');
    expect(event).toMatchObject({ result: { data: { blob: '[Blob omitted]' } } });
    expect(JSON.stringify(checkpoint)).not.toContain('private attachment text');
    expect(JSON.stringify(checkpoint)).not.toContain('data:text/plain;base64');
    expect(checkpoint?.messages[0]?._ui_attachments?.[0]).not.toHaveProperty('file');
  });

  it('filters generated directories and keeps the last complete snapshot when a replacement exceeds limits', async () => {
    const result = sanitizeSnapshotTree({
      'src': { directory: { 'index.ts': { file: { contents: 'ok' } } } },
      'node_modules': { directory: { 'pkg.js': { file: { contents: 'large' } } } },
      'dist': { directory: { 'bundle.js': { file: { contents: 'built' } } } },
    });
    expect(result.tree).toEqual({ src: { directory: { 'index.ts': { file: { contents: 'ok' } } } } });
    expect(result.fileCount).toBe(1);
    const tooMany = Object.fromEntries(Array.from({ length: SNAPSHOT_MAX_FILES + 1 }, (_, index) => [`${index}.txt`, { file: { contents: '' } }]));
    expect(() => sanitizeSnapshotTree(tooMany)).toThrow(SnapshotLimitError);
    expect(() => sanitizeSnapshotTree({ 'too-large.bin': { file: { contents: new Uint8Array(SNAPSHOT_MAX_BYTES + 1) } } })).toThrow(SnapshotLimitError);
    await repository.saveSnapshot('bounded', result.tree, 1);
    await expect(repository.saveSnapshot('bounded', tooMany, 2)).rejects.toThrow(SnapshotLimitError);
    expect(await repository.loadSnapshotState('bounded')).toMatchObject({ value: { revision: 1, tree: result.tree } });
  });

  it('quarantines malformed v3 records once and preserves the raw data', async () => {
    await repository.loadWorkspace();
    await putRaw('runs', { id: 'broken-run', formatVersion: V3_PERSISTENCE_VERSION, updatedAt: 1, payload: { id: 'broken-run' } });
    await putRaw('events', { id: 'broken-event', formatVersion: V3_PERSISTENCE_VERSION, updatedAt: 2, payload: { id: 'broken-event', kind: 'message', sessionId: 's-1', runId: 'r-1', sequence: 1, createdAt: 2 } });
    await putRaw('checkpoints', { id: 'broken-checkpoint', formatVersion: V3_PERSISTENCE_VERSION, updatedAt: 3, payload: { id: 'broken-checkpoint', runId: 'broken-checkpoint', sessionId: 's-1', containerId: 'c-1', summary: 'bad', messages: [{ role: 'user', content: 42 }], createdAt: 3 } });
    expect((await repository.listRuns()).issues).toHaveLength(1);
    expect((await repository.loadRun('broken-run')).value).toBeNull();
    expect((await repository.listRuns()).issues).toHaveLength(1);
    expect((await repository.listEvents('s-1')).issues).toHaveLength(1);
    expect((await repository.latestCheckpoint('broken-checkpoint')).value).toBeNull();
    expect(await repository.listIssues()).toEqual(expect.arrayContaining([
      expect.objectContaining({ store: 'runs', recordId: 'broken-run' }),
      expect.objectContaining({ store: 'events', recordId: 'broken-event' }),
      expect.objectContaining({ store: 'checkpoints', recordId: 'broken-checkpoint' }),
    ]));
  });

  it('round-trips terminal history and snapshots and removes a complete container scope', async () => {
    const activeRun = run('r-container');
    await repository.saveRun(activeRun);
    await repository.appendEvent({ ...messageEvent(1), id: 'r-container:1', runId: activeRun.id });
    await repository.saveCheckpoint({ id: activeRun.id, runId: activeRun.id, sessionId: 's-1', containerId: 'c-1', summary: 'checkpoint', messages: [], createdAt: 1 });
    await repository.saveTerminalHistory('s-1', 'history');
    await repository.saveSnapshot('c-1', { 'src': { directory: { 'index.ts': { file: { contents: 'ok' } } } } });
    await repository.saveResource({ id: 'container-resource', sessionId: 's-1', originatingRunId: activeRun.id, name: 'a.txt', kind: 'text', mimeType: 'text/plain', size: 1, sha256: 'container-hash', createdAt: 1, blob: new NodeBlob(['a']) as unknown as Blob });
    await repository.saveAgentTask({ id: 'task-container', taskId: 'task-container', sessionId: 's-1', rootRunId: activeRun.id, parentRunId: activeRun.id, runId: 'child', role: 'explore', prompt: 'inspect', status: 'queued', createdAt: 1, updatedAt: 1, evidence: [], changedPaths: [], verificationRecords: [] });
    expect((await repository.loadTerminalHistory('s-1')).value).toBe('history');
    expect((await repository.loadSnapshot('c-1')).value).toHaveProperty('src');
    expect((await repository.findResourceBySha('s-1', 'container-hash')).value?.id).toBe('container-resource');
    expect((await repository.listAgentTasks(activeRun.id)).value).toHaveLength(1);
    await repository.deleteContainer('c-1');
    expect((await repository.loadRun(activeRun.id)).value).toBeNull();
    expect((await repository.latestCheckpoint(activeRun.id)).value).toBeNull();
    expect((await repository.loadSnapshot('c-1')).value).toBeNull();
    expect((await repository.listResources('s-1')).value).toEqual([]);
    expect((await repository.listAgentTasks(activeRun.id)).value).toEqual([]);
  });

  it('keeps a deduplicated resource alive while another container run still references it', async () => {
    const first = run('r-first');
    const second = { ...run('r-second'), containerId: 'c-2' };
    await repository.saveRun(first);
    await repository.saveRun(second);
    await repository.saveResource({ id: 'shared-resource', sessionId: 's-1', originatingRunId: first.id, name: 'shared.txt', kind: 'text', mimeType: 'text/plain', size: 6, sha256: 'shared-hash', createdAt: 1, blob: new NodeBlob(['shared']) as unknown as Blob });
    await repository.appendEvent({ id: 'r-second:1', kind: 'message', sessionId: 's-1', runId: second.id, sequence: 1, createdAt: 2, message: { role: 'user', content: 'reuse', resourceIds: ['shared-resource'], contentParts: [{ type: 'file_resource', resourceId: 'shared-resource' }] } });
    await repository.deleteContainer('c-1');
    expect(await repository.loadResource('shared-resource')).toMatchObject({ value: { originatingRunId: second.id } });
    await repository.deleteContainer('c-2');
    expect((await repository.loadResource('shared-resource')).value).toBeNull();
  });

  it('stores repeated model task labels under independent delegated-task identities', async () => {
    const base = { taskId: 'inspect', sessionId: 's-1', rootRunId: 'root', parentRunId: 'root', role: 'explore' as const, prompt: 'inspect', status: 'queued' as const, createdAt: 1, updatedAt: 1, evidence: [], changedPaths: [], verificationRecords: [] };
    await repository.saveAgentTask({ ...base, id: 'task-internal-1', runId: 'child-1' });
    await repository.saveAgentTask({ ...base, id: 'task-internal-2', runId: 'child-2', createdAt: 2, updatedAt: 2 });
    expect((await repository.listAgentTasks('root')).value).toEqual([
      expect.objectContaining({ id: 'task-internal-1', taskId: 'inspect' }),
      expect.objectContaining({ id: 'task-internal-2', taskId: 'inspect' }),
    ]);
  });
});
