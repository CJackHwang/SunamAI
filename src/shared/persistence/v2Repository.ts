import type { FileSystemTree } from '@webcontainer/api';
import type { WorkspaceState } from '@/entities/workspace/types';
import type { AgentCheckpoint, AgentEvent, AgentRun } from '@/entities/agent/types';
import { V2Database } from './v2Database';
import { AgentV2Repository, SnapshotV2Repository, TerminalV2Repository, WorkspaceV2Repository } from './v2Repositories';
import { QuarantineRepository } from './v2RecordStore';
import type { V2DataIssue, V2ListResult, V2ReadResult } from './v2Schema';

export { V2_PERSISTENCE_DATABASE, V2_PERSISTENCE_VERSION } from './v2Schema';
export type { V2DataIssue, V2ListResult, V2ReadResult } from './v2Schema';

/** Stable facade used by application code; storage responsibilities live in typed repositories. */
export class V2PersistenceRepository {
  private readonly database = new V2Database();
  private readonly quarantine = new QuarantineRepository(this.database);
  private readonly workspace = new WorkspaceV2Repository(this.database, this.quarantine);
  private readonly agent = new AgentV2Repository(this.database, this.quarantine);
  private readonly terminal = new TerminalV2Repository(this.database, this.quarantine);
  private readonly snapshots = new SnapshotV2Repository(this.database, this.quarantine);

  loadWorkspace(): Promise<V2ReadResult<WorkspaceState>> { return this.workspace.load(); }
  saveWorkspace(workspace: WorkspaceState): Promise<void> { return this.workspace.save(workspace); }
  saveRun(run: AgentRun): Promise<void> { return this.agent.saveRun(run); }
  loadRun(runId: string): Promise<V2ReadResult<AgentRun>> { return this.agent.loadRun(runId); }
  listRuns(sessionId?: string): Promise<V2ListResult<AgentRun>> { return this.agent.listRuns(sessionId); }
  appendEvent(event: AgentEvent): Promise<void> { return this.agent.appendEvent(event); }
  listEvents(sessionId: string): Promise<V2ListResult<AgentEvent>> { return this.agent.listEvents(sessionId); }
  saveCheckpoint(checkpoint: AgentCheckpoint): Promise<void> { return this.agent.saveCheckpoint(checkpoint); }
  latestCheckpoint(runId: string): Promise<V2ReadResult<AgentCheckpoint>> { return this.agent.latestCheckpoint(runId); }
  loadTerminalHistory(sessionId: string): Promise<V2ReadResult<string>> { return this.terminal.load(sessionId); }
  saveTerminalHistory(sessionId: string, content: string): Promise<void> { return this.terminal.save(sessionId, content); }
  loadSnapshot(containerId: string): Promise<V2ReadResult<FileSystemTree>> { return this.snapshots.load(containerId); }
  saveSnapshot(containerId: string, tree: FileSystemTree): Promise<void> { return this.snapshots.save(containerId, tree); }
  listIssues(): Promise<V2DataIssue[]> { return this.quarantine.list(); }

  async deleteSession(sessionId: string): Promise<void> {
    await this.database.write(['runs', 'events', 'checkpoints', 'terminalHistory'], async (transaction) => {
      await this.agent.deleteSession(sessionId, transaction);
      transaction.objectStore('terminalHistory').delete(sessionId);
    });
  }

  async deleteContainer(containerId: string): Promise<void> {
    await this.database.write(['runs', 'events', 'checkpoints', 'snapshots'], async (transaction) => {
      await this.agent.deleteContainer(containerId, transaction);
      transaction.objectStore('snapshots').delete(containerId);
    });
  }
}

export const v2Persistence = new V2PersistenceRepository();
