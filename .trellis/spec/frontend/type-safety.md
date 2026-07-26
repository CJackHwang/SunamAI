# Type Safety

## Compiler baseline

`tsconfig.app.json` enables `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitReturns`, unused checks, and fallthrough checks. New code must pass without weakening these flags.

## Type ownership

- Cross-layer interfaces live in `src/shared/contracts`.
- Domain records live in their entity, for example `entities/agent/types.ts`, `entities/message/types.ts`, and `entities/resource/types.ts`.
- Implementation-only types stay beside the implementation.
- Use `import type` for type-only dependencies.
- Prefer discriminated unions for message content, events, phases, roles, and resource kinds.

## Runtime validation

Static types do not validate provider, browser, or IndexedDB data.

- Use Zod at API/tool boundaries: `src/shared/api/sse.ts`, `src/features/agent-core/tools.ts`.
- Use deep guards before accepting persisted records: `src/entities/persistence/v3Schema.ts`.
- Quarantine malformed durable records rather than coercing them or inventing defaults.
- Validate resource MIME signatures and safe text decoding before persistence.
- Treat JSON parse failure as invalid input unless the UI is explicitly rendering an incomplete streaming fragment.

## Canonicalization

Normalize messages with `canonicalizeMessage` / `canonicalContentParts` at boundaries. Internally, resource references are typed content parts and durable IDs; provider adapters create temporary wire representations only for the request.

With exact optional properties, use conditional spreads:

```ts
return { value, ...(detail ? { detail } : {}) };
```

Do not assign `undefined` to an optional field.

## Assertions and escape hatches

- Do not use `any` in production code.
- Avoid `as unknown as`; it is acceptable in tests that bridge Node polyfills to browser-only types and the mismatch is explicit.
- Non-null assertions require an immediately established invariant, such as an index checked in the preceding branch.
- Do not use `@ts-ignore`. A narrowly documented `@ts-expect-error` is preferable only when testing a compiler failure.
- Do not cast unvalidated JSON to a domain record.

References: `src/shared/contracts/message.ts`, `src/entities/persistence/v3Schema.ts`, `src/features/agent-core/resourceProcessor.ts`, and `tests/unit/v3Schema.test.ts`.
