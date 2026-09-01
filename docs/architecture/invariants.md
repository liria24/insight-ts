# Architecture invariants

## Dependency boundaries

- Core imports no Provider implementation, canonical capability helper, History Engine,
  OpenTelemetry package, Integration, UI framework, DOM API, or renderer.
- Providers and capability helpers depend on Core; Provider implementations import no
  Integration, History, or UI layer.
- History depends on Core and capability contracts. UI Core depends on Core and Metrics
  independently.
- `@opentelemetry/api` is an optional peer reachable only from `insight-ts/opentelemetry`.
- Integrations depend only on the layers they connect; no mandatory Integration interface exists.
- UI renderer code and CSS are reachable only from `insight-ts/vue/ui`.
- Nitro is not H3. Nuxt composes Nitro rather than duplicating storage or task wiring.

## Scope and query behavior

- Scopes are logical analysis boundaries. Provider IDs and native resource names never become
  Scope names implicitly.
- Queries select canonical capabilities with `q.metrics()`, `q.logs()`, `q.traces()`, or another
  registered contract. Provider/adapter accessors are not public.
- Capability normalization is pure, deterministic, and I/O-free; adapter plans have exact dedupe
  keys.
- `insight.query()` is lazy: only descriptors returned by the selection callback execute.
- Equivalent normalized plans execute once; Providers receive compatible request groups and
  fallback execution is bounded.
- `AbortSignal` belongs to query execution options and reaches Provider and adapter execution.
- Core constructs every `QueryResult` envelope and validates shared `QueryQuality`.
- Provider validation happens before network I/O. Native metadata remains adapter-private unless
  mapped to a canonical contract.
- External I/O scales with Provider request groups or History range slices, never result rows.
- `meta.contributions` preserves merged Quality without exposing adapter IDs. Pagination cursors
  are opaque, serializable, bound to one logical result, and do not advance sibling results.

## Metrics and filters

- Metrics are an optional canonical capability, not Core semantics.
- A canonical Metric name has exactly one owner in a Scope.
- Metric data is row-major with shared point time and dimensions; Provider output is normalized
  once at the Metric boundary.
- Metric values are `number | null`; semantic units and aggregation never encode presentation.
- Aggregations are structured. Ratios name supporting Metrics; unsafe percentile and other
  non-additive rollups are rejected.
- Selected dimensions and filters must be supported by every adapter contributing selected
  Metrics; incompatibility fails before I/O.
- `where` is typed from configured canonical dimension schemas. Equivalent shorthand/operator
  forms normalize to one key.

## Logs, traces, and events

- Logs and Traces use canonical common fields and stable IDs; arbitrary attributes preserve data
  that has no portable semantic.
- OpenTelemetry guides observability interoperability but is not a universal Core data model.
- Finite Log and Trace results are deterministically ordered and use per-result pagination.
- Hosts own OTel SDKs, exporters, Collectors, sampling, and baggage.
- Instrumentation attributes use `insight.*` and never contain raw queries, filters, event
  properties, credentials, or PII.
- Browser events are same-origin, bounded, schema-validated, and best effort. IDs, timestamps, and
  origin are server-owned.

## History

- History is one optional workflow across canonical capabilities; capability-specific strategy
  types are not public.
- Query and History use the same absolute half-open `{ from, to }` range.
- The Engine owns coverage, gaps, complete page draining, composition, reductions, Fidelity,
  materialization IDs, bounded orchestration, and lifecycle.
- Capability materializers may suggest a time partition size; the Engine plans and commits those
  partitions incrementally.
- Capability contracts own data-specific range clipping, identity, merge, and reduction.
- Event-like Repository reads are bounded. Repositories do not interpret or silently reduce data
  and expose explicit deletion/replacement operations.
- Complete empty ranges, policy-reduced data, and missing or provisional coverage remain distinct
  through range-scoped Fidelity.
- Provider Quality and range-scoped History Fidelity remain distinct.
- Nitro Tasks may invoke only `insight.history.sync()` and are explicitly enabled.
- Nitro History range operations enumerate only indexed overlapping partitions.

## UI and Nuxt

- Public UI renders Metric results and never performs Provider I/O, auth, caching, or History.
- Every data-bearing Vue prop is named `data`; line/area render all selected Metrics in query order.
- Presentation formatters own percent, currency, and compact notation.
- Logs and Traces renderers remain application-local.
- Nuxt does not register Vue UI, scan UI source, control Vapor, or serialize secrets.
- Vue VDOM and Vapor compile the same SFC source; no Vapor-specific public entry exists.
