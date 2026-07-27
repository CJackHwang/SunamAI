# Model Context And Messages

## Applicability

Read this leaf when changing model profiles, token estimation/usage, canonical messages/content parts, provider requests, streaming reasoning, compaction, fallback retry, or rehydration.

## Required Behavior

```ts
interface ModelContextProfile {
  contextWindowTokens: number;
  defaultOutputTokens: number;
  summaryReserveTokens: number;
  safetyBufferTokens: number;
}

interface AgentModelClient {
  readonly capabilities?: { vision: boolean | 'unknown'; files: boolean; toolCalls: boolean };
  getContextProfile?(): ModelContextProfile;
  estimateTokens?(value: string): number;
  complete(messages: Message[], options: {
    signal: AbortSignal;
    tools: LLMToolDefinition[];
    onDelta: (message: Pick<Message, 'content' | 'reasoning_content'>) => void;
  }): Promise<AgentModelResponse>;
}

type MessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_resource'; resourceId: string }
  | { type: 'file_resource'; resourceId: string };
```

- Effective input budget is `contextWindow - defaultOutput - summaryReserve - safetyBuffer`, including system prompt, tool schemas, transcript, and media estimates.
- Unknown models use a conservative 32k profile.
- OpenAI-compatible optional `content` / `reasoning_content` accept `string | null | undefined`; normalize null to absent and reject other types at the adapter boundary.
- Streaming reasoning survives tool-call rounds and final plain messages.
- Assistant tool calls and matching results are indivisible groups; trim/retry removes complete groups.
- Automatic compaction runs before exhaustion with no user setting/button. Semantic compaction uses `tools: []` and replaces media/bodies/Base64 with durable ID markers.
- PTL recovery makes at most three requests, removing the oldest 20% complete groups per attempt; then deterministic summary plus circuit reason owns fallback.
- An oversized newest round is estimator-clipped until `afterTokens <= effectiveTokens`.
- Rehydration includes Task Contract, plan, evidence, authoritative revision, event tail, resource IDs, active/unfinished subagents, and at most five bounded file slices.
- `canonicalContentParts`, `messageText`, and `canonicalizeMessage` own internal normalization. Provider adapters create temporary `image_url` data only while building outbound requests.

### Validation And Error Matrix

| Condition | Required behavior |
| --- | --- |
| Unknown model | Use conservative 32k profile. |
| `content: null` with reasoning string | Accept, no-op content, and persist accumulated reasoning. |
| Optional delta field is non-null/non-string | Reject/ignore at the validated adapter boundary; never cast into `Message`. |
| Context exceeds budget after semantic attempts | Deterministic clipped summary, bounded groups, `fallbackReason`, no fourth call. |
| Abort during compaction/model/tool wait | Propagate cancellation; do not retry as ordinary failure. |
| Tool-call group lacks a result | Remove the invalid group or keep safe plain assistant text only. |

## Forbidden Behavior

```ts
// Wrong: engine branches on provider names.
if (model.includes('claude')) maxTokens = 200_000;

// Correct: adapter/profile owns provider behavior.
const profile = client.getContextProfile?.() ?? profileForModel('unknown');
```

Do not use a strict string-only delta schema that discards valid reasoning because optional content is null. Do not keep Blob/File bodies, data URLs, or long Base64 in compaction/model history.

## Required Validation

- Context tests: complete groups, media stripping, micro-compaction, three-attempt bound, abort, deterministic circuit, oversized-round clipping, and rehydration fields.
- Adapter tests: exact outbound parts, nullable deltas, final reasoning preservation, usage mapping, vision caching/fallback, and unrelated 400/422 propagation.

## Related Contracts

- [Resources](./resources.md)
- [Checkpoint and recovery](./checkpoint-and-recovery.md)
- References: `src/features/agent-core/context.ts`, model adapters, `src/shared/contracts/message.ts`, and `tests/unit/agentContext.test.ts`.
