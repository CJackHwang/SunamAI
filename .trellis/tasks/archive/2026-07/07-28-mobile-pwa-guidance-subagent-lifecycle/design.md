# Technical Design

## UI Material And Focus

Replace generic `prefers-contrast: more` visual degradation with a
`forced-colors: active` fallback for glass surfaces. This keeps user-selected
increased contrast distinguishable without treating ordinary mobile browser
contrast reporting as a request to disable material. Retain the shared
standard and `-webkit-` backdrop declarations.

Gate terminal auto-focus by the same mobile viewport threshold used by the
composer. A tab change may set the active panel but cannot invoke terminal
focus on mobile.

## Root Guidance Queue

`AgentEngine` owns a FIFO external-guidance queue. `enqueueUserGuidance` emits
a persisted user message immediately for projection, then appends the text to
the model transcript as a canonical user message immediately before the next
model request. This preserves chronological visible conversation and
guarantees the current tool batch completes before the guidance changes model
context. Pending guidance also defers a racing plain or structured completion
until a later model turn has consumed it.

`useAgentV2` routes a new `guideActiveTask` call to the active root execution
for the current session. `Workspace` uses that call while active instead of
`startTask`; the composer stays enabled. Its existing action button remains a
single stateful command: Stop when the running input is empty, Send when it has
guidance. RunBoard does not own a second stop action.

## Child Lifecycle

Child engines receive a role-specific tool policy that excludes `ask_user` and
adds `ask_parent`. `ask_parent` is terminal for the current child model turn:
it writes an `awaiting_parent` state and structured blocker notification for
the root Agent, never an end-user question. For depth-one runs,
`AgentEngine` persists a plain final response as non-terminal child progress
and continues the same Run; completion remains exclusive to `complete_task`.
The coordinator forwards root messages to an awaiting child and resumes its
next model turn under the same child run where safe.
`wait_subagents` returns the blocker as one lifecycle notification without
resolving the child's distinct terminal promise. The coordinator restores a
public per-child stop used only by the React controller and selected-child
footer; child model tools still cannot stop themselves. Active child deletion
remains separate and fails closed until the child becomes terminal.

## Activity And Tool Presentation

`ContextComposer` invokes a callback only after it decides compaction is
required. `AgentEngine` brackets that work with transient compaction-status
events, and `useAgentV2` projects the state for the currently viewed Run. The
chat thinking indicator switches its localized label while keeping the same
bounded layout and periodic text sheen.

Assistant prose remains visible when the same message owns tool calls. Native
tool disclosures retain their semantic behavior, with a fixed maximum body
height and internal overflow instead of expanding the conversation endlessly.

## Risk And Rollback

The guidance queue and compaction status are in-memory for a live run;
interrupted runs keep already-emitted visible guidance and use existing
checkpoint recovery. Transient compaction status never enters persistence.
