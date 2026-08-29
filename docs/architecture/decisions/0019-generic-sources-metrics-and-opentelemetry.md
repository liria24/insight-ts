# 0019: Generic Sources, Metric helpers, and OpenTelemetry instrumentation

Status: accepted

Supersedes the public Source/query/report contract in ADR 0013 and ADR 0016, the snapshot capture
model in ADR 0016, and the Core report dependency described in ADR 0018. Their Provider
validation, History repository, Nitro composition, UI renderer isolation, and framework boundary
decisions remain accepted.

## Decision

Core models only `Provider -> Source<TQuery, TNormalized, TData, TMeta>`. A Source owns pure
deterministic `normalize()`, exact `key()`, and `execute()` methods. Applications lazily select any
number of heterogeneous Sources with one `insight.query(q => ({ ... }))` call. Core normalizes,
deduplicates by Source-owned keys, groups requests by Provider, applies bounded concurrency, and
constructs the `QueryResult` envelope. `AbortSignal` is an execution option, not Source query data.

Core interprets neither query objects nor result data. It retains only cross-cutting
`QueryQuality`: approximation, partiality, sampling, thresholding, and warnings. Analytics,
product, billing, logs, traces, funnels, and profiles remain Source-owned contracts rather than a
Core union.

Metric semantics live in `insight-ts/metrics` as `defineMetricSource()` over `defineSource()`.
Metric definitions separate semantic label/unit/structured aggregation/rollup from UI
presentation. Metric filters use a typed object DSL derived from each dimension schema and
normalize to a canonical Source-owned AST. Histograms and distributions are deferred until a real
capability requires them.

History is an optional Source-specific strategy. The current implementation supports Metric
Sources, fetches through normal multi-query execution, recomputes derived ratios, and rejects
unsafe percentile and other non-additive rollups. Snapshot capture is removed.

OpenTelemetry is the canonical observability interoperability standard, not Insight.ts's universal
data model. Core exposes a small generic instrumentation port and imports no OpenTelemetry package.
`insight-ts/opentelemetry` adapts that port with optional peer `@opentelemetry/api`; hosts own SDKs,
exporters, Collectors, and baggage. Instrumentation uses `insight.*` attributes and excludes raw
queries, filter values, event properties, and PII. Active trace/span IDs may be linked to events.

Public UI remains Metric Source-specific. Vue props use `data`; line and area charts render all
selected metrics in Source order, while stat, sparkline, and bar components select only what their
presentation needs. Logs, traces, funnels, and billing renderers remain application-local until
their Provider contracts stabilize.

## Consequences

Adding a new Source shape requires no Core change. Equivalent Metric filter spellings deduplicate
exactly after normalization. OpenTelemetry remains absent from the default runtime graph. There are
no alpha compatibility aliases for reports, snapshot capture, old filter tuples, or old UI props.
