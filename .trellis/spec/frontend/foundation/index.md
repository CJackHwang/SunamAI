# Foundation Spec Index

## Scope

Use this router for production dependency direction, file placement, module boundaries, and typed validation.

## Routes

| Question | Read |
| --- | --- |
| Which layer owns the behavior and which imports are allowed? | [Architecture and boundaries](./architecture-and-boundaries.md) |
| Where should a file live and what should its public module expose? | [Directory structure](./directory-structure.md) |
| Where do TypeScript types, runtime guards, and canonicalization belong? | [Type safety](./type-safety.md) |

## Validation Entry Point

Run the checks selected by [Validation gates](../quality/validation-gates.md); architecture changes must include `npm run check:architecture` through the documented gate.
