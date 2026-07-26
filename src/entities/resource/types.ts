export type AgentResourceKind = 'text' | 'image' | 'binary';

export interface AgentResource {
  id: string;
  sessionId: string;
  originatingRunId: string;
  name: string;
  kind: AgentResourceKind;
  mimeType: string;
  size: number;
  sha256: string;
  createdAt: number;
}

export interface StoredAgentResource extends AgentResource {
  blob: Blob;
  modelBlob?: Blob;
}
