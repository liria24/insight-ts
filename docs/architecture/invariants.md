# Architecture invariants

## Dependency boundaries

- Core imports no Provider implementation, Metric helper, History Engine, OpenTelemetry package,
  Integration, UI framework, DOM API, or renderer.
- Providers and Metric helpers depend on Core; Provider implementations import no Integration,
  History, or UI layer.
- History depends on Core and Metric contracts. UI Core does the same independently.
- `@opentelemetry/api` is an optional peer reachable only from `insight-ts/opentelemetry`.
- Integrations depend only on the layers they connect; no mandatory Integration interface exists.
- UI renderer code and CSS are reachable only from `insight-ts/vue/ui`.
- Nitro is not H3. Nuxt composes Nitro rather than duplicating storage or task wiring.

## Source and query behavior

- Source IDs are `${providerId}.${sourceKey}` and are selected explicitly with `q.source()`.
- `normalize()` is pure, deterministic, and I/O-free; `key()` is the exact Source-owned dedupe key.
- Core does not inspect query objects, filter ASTs, dimensions, grains, cursors, or result data.
- `insight.query()` is lazy: only descriptors returned by the selection callback execute.
- Equivalent normalized queries for one Source execute once; Providers receive compatible request
  groups and fallback execution is bounded.
- `AbortSignal` belongs to query execution options and reaches Provider and Source execution.
- Core constructs every `QueryResult` envelope and validates only shared `QueryQuality`.
- Provider validation happens before network I/O. Provider metadata remains Source-specific.
- External I/O scales with Provider request groups or History range slices, never result rows.

## Metrics and filters

- Metric semantics are optional helpers, not Core semantics.
- Metric values are `number | null`; semantic units and aggregation never encode presentation.
- Aggregations are structured. Ratios name supporting metrics; unsafe percentile and other
  non-additive rollups are rejected.
- Histogram/distribution capability does not exist until a real Provider requires it.
- `where` is derived from a Source's dimension schema. Scalar values mean equality; fields and
  operators in one object are implicit AND; `AND`, `OR`, and `NOT` are explicit groups.
- Only field-supported operators and value types appear in TypeScript. Canonical normalization
  makes equivalent shorthand/operator forms share one key.

## Observability and events

- OpenTelemetry is the observability interoperability standard, not the universal Source model.
- Hosts own OTel SDKs, exporters, Collectors, sampling, and baggage.
- Instrumentation attributes use `insight.*` and never contain raw queries, filters, event
  properties, credentials, or PII.
- Active trace/span IDs may be linked to tracked events; baggage is never copied automatically.
- Browser events are same-origin, bounded, schema-validated, and best effort. IDs, timestamps, and
  origin are server-owned.

## History

- History is an optional Source-specific strategy; the implemented strategy is Metric-only.
- History fetches through normal multi-query execution.
- The Engine owns coverage, gaps, composition, safe rollup, reductions, Fidelity, segment IDs, and
  idempotency. Repositories only implement `coverage`, `read`, and `write`.
- Provider Quality and range-scoped History Fidelity remain distinct.
- Nitro Tasks may invoke only `insight.history.sync()` and are explicitly enabled.

## UI and Nuxt

- Public UI renders Metric Source results and never performs Provider I/O, auth, caching, or History.
- Every data-bearing Vue prop is named `data`; line/area render all selected metrics in Source order.
- Presentation formatters own percent, currency, and compact notation.
- Logs, traces, funnels, and billing renderers remain application-local.
- Nuxt does not register Vue UI, scan UI source, control Vapor, or serialize secrets.
- Vue VDOM and Vapor compile the same SFC source; no Vapor-specific public entry exists.
