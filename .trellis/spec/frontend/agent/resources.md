# Agent Resources

## Applicability

Read this leaf when changing uploads, resource IDs, processors, MIME checks, limits, deduplication, model copies, provider vision fallback, or workspace materialization.

## Required Behavior

The runtime boundary remains session-scoped:

```ts
interface AgentWorkspaceRuntime {
  readResourceText(sessionId: string, resourceId: string, startLine?: number, endLine?: number, maxTokens?: number): Promise<string>;
  readResourceImage(sessionId: string, resourceId: string): Promise<RuntimeResourceDescriptor>;
  materializeResource(sessionId: string, containerId: string, resourceId: string, path: string): Promise<WorkspaceChangeSummary>;
}
```

- Blob/modelBlob data lives only in the `resources` store. Messages/events/checkpoints contain IDs and safe UI metadata.
- Enforce limits in UI intake and `ResourceProcessorRegistry`: 8 resources/message, text 2 MiB, image 10 MiB, binary 20 MiB, batch 50 MiB. Existing IDs count toward limits.
- SHA-256 dedupe is session-scoped. Every read/materialize verifies `sessionId`.
- Images pass signature sniffing and browser decode/dimension validation. Model copy is at most 2048px longest edge and 1.5 MiB; original remains materializable.
- Vision fallback only handles HTTP 415 or 400/422 text clearly identifying unsupported vision/image/multimodal/content parts. Other 4xx errors propagate.
- Images/text are first-class model resources. Other binaries may persist/materialize; directly consumable types extend `ResourceProcessorRegistry`, not `AgentEngine`.

### Validation And Error Matrix

| Condition | Required behavior |
| --- | --- |
| Resource ID belongs to another session | Reject without metadata/body/materialization. |
| Declared image/text MIME fails sniff/decode | Reject the entire batch before persistence. |
| Limit includes existing plus new resources | Enforce count and total size atomically. |
| Provider returns unrelated 400/422 | Propagate `LLMError`; do not mark vision unsupported or retry text-only. |
| Materialization path escapes root/write scope | Reject before writing; use workspace mutation contract. |

## Forbidden Behavior

```ts
// Wrong: transport body enters the event ledger.
await repository.appendEvent({ kind: 'message', message: { content: await file.text(), file } });

// Correct: persist once and reference the durable ID.
await repository.saveResource(storedResource);
await repository.appendEvent({
  kind: 'message',
  message: canonicalizeMessage({
    role: 'user', content: 'Inspect the attachment.',
    contentParts: [{ type: 'file_resource', resourceId: storedResource.id }],
    resourceIds: [storedResource.id],
  }),
});
```

Do not trust UI-only validation, dedupe across sessions, persist transport bodies in ledgers, or broadly retry provider errors.

## Required Validation

- Count/size limits, atomic batch failure, same-session dedupe, cross-session rejection, MIME spoof, invalid UTF-8, image limits, Blob absence from ledgers, materialization, and vision fallback classification.
- UI/E2E proves resource cards use IDs and multimodal fallback remains visible.

## Related Contracts

- [Model context and messages](./model-context-and-messages.md)
- [Workspace namespace](./workspace-namespace.md)
- [Persistence and snapshots](./persistence-and-snapshots.md)
