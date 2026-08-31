# 0020: Canonical Provider factories and typed Source accessors

Status: accepted

Supersedes the public Provider-authoring import and Source-selection syntax following ADR 0019.
Its generic Source model, execution, quality, History, and instrumentation decisions remain accepted.

## Decision

`defineProvider()` and `defineSource()` are Core authoring helpers exported from `insight-ts`; the
`insight-ts/provider` entrypoint does not exist. Built-in Providers are consumed through their
canonical factories, such as `cloudflare()` and `googleSearchConsole()`, which preserve their exact
configured Source maps and Source-specific query/result types.

Provider IDs use strict ASCII kebab-case. Source keys use lower-camel-case ASCII identifiers.
`createInsight()` rejects invalid IDs, invalid keys, duplicate IDs, and collisions in the
deterministic kebab-case-to-camelCase Provider accessor. It builds a prototype-safe nested registry
once, without Proxy or per-query casing work.

Queries use `q.source.<providerAccessor>.<sourceKey>(query)`. The former string selector has no
overload or compatibility alias. Canonical `${provider.id}.${sourceKey}` IDs remain unchanged for
metadata, History, deduplication, execution, and instrumentation.

## Consequences

Consumers receive progressive Provider and Source autocomplete without `as const` or explicit
generics. Built-in factory options determine which Sources exist in the type system. Custom
Provider authors retain the same generic contracts from the root package, while optional semantic
and integration functionality remains in subpath entrypoints.
