# 0022: Scopes and canonical capabilities

Status: accepted

Supersedes the public Provider/Source query model in ADR 0019 and ADR 0020 and the Metric-only
History contract in ADR 0019. Their generic execution, validation, bounded concurrency,
instrumentation, and UI boundary decisions remain accepted.

## Decision

The consumer workflows are Query, Track, and History. Query uses canonical, extensible capability
contracts. The first contracts are Metrics, Logs, and Traces; Core does not contain a closed enum
of them.

The default Scope is configured with `createInsight({ providers })` and queried with
`insight.query(q => ({ ... }))`. Multiple logical analysis boundaries use
`createInsight({ scopes: { production: [...], staging: [...] } })` and
`insight.scope('production').query(...)`. The scoped client exposes the same `query()` and
`track()` methods. Scope names never identify Providers, endpoints, or native datasets.

Query builders expose capability methods such as `q.metrics()`, `q.logs()`, and `q.traces()`.
Provider factories register internal adapters for those contracts. A generic capability contract
owns canonical normalization, adapter planning, deterministic merging, result typing, and optional
History materialization. Adapters own native validation, translation, pagination, authentication,
and execution. Internal adapter IDs remain available for grouping, dedupe, instrumentation, and
cursor state, but are absent from the consumer DSL and result metadata.

One Metric query can select Metrics owned by different adapters. A Scope has one owner for each
canonical Metric name; duplicate ownership is rejected rather than silently combining unrelated
totals. Every selected dimension and filter must be supported by every contributing adapter, and
the planner rejects an incompatible query before I/O. Metric contributions merge by normalized
time and dimension keys in selected Metric order.

Logs and Traces use portable fields guided by OpenTelemetry semantics without exposing OTel or
Provider-native paths in ordinary queries. Canonical Log and Trace IDs are required for stable
dedupe. `q.traces({ traceId })` uses the same finite ordered result envelope as trace search instead
of adding a second helper.

Query and History use absolute ISO half-open `{ from, to }` ranges. Structured relative boundaries
may be added when a real caller requires them; execution and storage always receive absolute
instants.

Every result is a plain serializable envelope. `meta.contributions` preserves field-level or
per-contribution Quality without publishing adapter identity. Pageable results expose only
`meta.pagination.next`; absence of `next` is terminal and no `hasMore` claim is inferred. The
opaque cursor binds the logical query and contains any adapter continuation and merged frontier
state required to resume only that result.

History is one optional workflow across capabilities. The Engine owns range planning, complete
pagination draining, materialization identity, bounded orchestration, Fidelity, and lifecycle.
Capability contracts own data-specific clipping, identity, merge, and reduction. Repositories use
bounded range reads and explicit delete/replace primitives; they do not interpret capability data.

## Consequences

Normal query code contains no Provider or Source accessor. Adding a future canonical capability
does not change a universal Core signal union. Provider topology can change within a Scope without
rewriting consumers. Ambiguous Metric ownership and incompatible cross-adapter queries fail before
network I/O. The pre-release `q.source.*`, `sources()`, and `meta.source` contracts are removed
without compatibility aliases.
