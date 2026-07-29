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
- Actual compaction is bracketed by transient `context_compaction_status` events. React projects active status as the localized automatic-compaction label in the thinking-indicator slot; the transient event is never persisted.
- PTL recovery makes at most three requests, removing the oldest 20% complete groups per attempt; then deterministic summary plus circuit reason owns fallback.
- An oversized newest round is estimator-clipped until `afterTokens <= effectiveTokens`.
- Rehydration includes Task Contract, plan, evidence, authoritative revision, event tail, resource IDs, active/unfinished subagents, and at most five bounded file slices.
- `canonicalContentParts`, `messageText`, and `canonicalizeMessage` own internal normalization. Provider adapters create temporary `image_url` data only while building outbound requests.
- Assistant prose remains visible when the same message also owns tool calls; tool disclosures render after the prose instead of replacing it.

### Validation And Error Matrix

| Condition | Required behavior |
| --- | --- |
| Unknown model | Use conservative 32k profile. |
| `content: null` with reasoning string | Accept, no-op content, and persist accumulated reasoning. |
| Optional delta field is non-null/non-string | Reject/ignore at the validated adapter boundary; never cast into `Message`. |
| Context exceeds budget after semantic attempts | Deterministic clipped summary, bounded groups, `fallbackReason`, no fourth call. |
| Abort during compaction/model/tool wait | Propagate cancellation, emit inactive compaction status after an active start, and do not retry as ordinary failure. |
| Tool-call group lacks a result | Remove the invalid group or keep safe plain assistant text only. |

## Scenario: Mid-run root guidance

### 1. Scope / Trigger

Use this contract when changing the root composer, live execution registry, Agent transcript, message events, or completion ordering. Guidance steers one existing root Run and must never create a competing Run.

### 2. Signatures

```ts
class AgentEngine {
  enqueueUserGuidance(message: string): Promise<boolean>;
}

interface AgentController {
  guideActiveTask(message: string): Promise<boolean>;
}
```

### 3. Contracts

- Accept non-empty text only for the active root execution in the selected session.
- Emit one durable/projected user message immediately, then queue the canonical text FIFO.
- Flush accepted guidance into model transcript immediately before the next model request, never into an already active request.
- A queued item defers both plain and `complete_task` completion attempts until one later model turn has received it.
- Sending guidance does not abort the controller, call `startTask`, or accept new attachments.

### 4. Validation & Error Matrix

| Condition | Result |
| --- | --- |
| Empty text, child Run, missing execution, aborted/terminal Run | Return false; do not emit or queue. |
| Message-event persistence fails | Resolve the queue entry as rejected, surface the persistence error, and do not add it to model context. |
| Guidance arrives during a model/tool turn | Project now; deliver FIFO on the following model request. |
| Guidance races with completion | Defer completion, deliver guidance, then require a new completion decision. |

### 5. Good/Base/Bad Cases

- Good: two messages sent during one request appear immediately and arrive in order on request N+1.
- Base: no guidance; existing Run completion behavior is unchanged.
- Bad: Send aborts the Run, starts a second root Engine, injects into request N, or lets request N complete without reading queued guidance.

### 6. Tests Required

- Engine unit: active-request isolation, FIFO next-turn delivery, event projection once, and explicit-completion race.
- Component/E2E: textarea and shared action retain enabled styling while running; empty input exposes Stop, text exposes Send, and RunBoard has no separate root stop.
- Failure: no active execution and persistence rejection produce visible guidance failure without starting a Run.

### 7. Wrong vs Correct

```ts
// Wrong: creates/cancels root execution through the normal start path.
startTask(guidance);

// Correct: routes into the selected session's live root Engine.
await activeRoot.engine.enqueueUserGuidance(guidance);
```

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
- Projection/UI tests: active/inactive compaction status, prose-plus-tool rendering, and bounded tool disclosure overflow.

## Related Contracts

- [Resources](./resources.md)
- [Checkpoint and recovery](./checkpoint-and-recovery.md)
- References: `src/features/agent-core/context.ts`, model adapters, `src/shared/contracts/message.ts`, and `tests/unit/agentContext.test.ts`.
