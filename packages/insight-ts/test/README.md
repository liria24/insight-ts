# Test responsibilities

Tests are executable product contracts. A pure internal rewrite must not require changes to
Contract, Conformance, Protocol, Types, or Consumer checks.

| Prefix or location          | Responsibility                                      |
| --------------------------- | --------------------------------------------------- |
| `contract.*.test.ts`        | Public runtime behavior                             |
| `conformance.*.test.ts`     | Reusable extension-contract behavior                |
| `protocol.*.test.ts`        | Canonical ↔ Provider-native mappings                |
| `types.*.ts`                | Public TypeScript contracts; checked by `typecheck` |
| `integration.*.test.ts`     | Cross-feature and framework behavior                |
| `internal.*.test.ts`        | Implementation and architecture boundaries          |
| `scripts/test-consumers.ts` | Packed package behavior and emitted types           |
| `benchmark/*.bench.ts`      | Performance and regression measurement              |

Live Provider checks require credentials and belong in an explicit opt-in workflow, not the normal
test command. Deterministic fixtures are the default for Protocol tests.
