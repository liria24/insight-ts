# Insight.ts architecture

This living document is the authoritative description of the current architecture. Git history
records superseded designs. Any change that materially changes these boundaries or invariants must
update this file in the same pull request.

The governing product principle is:

> Broadly designed, narrowly implemented, minimally configured, runtime-native.

Insight.ts supports different Provider shapes without promising that every capability is portable.
It adds only contracts required by implemented behavior and asks users only for information the SDK
cannot derive.

## System shape

Core is the generic execution root. The project has independent branches rather than a mandatory
Integration or Adapter stack:

```text
Provider adapters ────────────────────┐
Canonical capability contracts ──────┤
History ──────────────────────────────┼──> Core scoped capability execution
OpenTelemetry instrumentation ────────┤
UI Core ──> Metrics + Core ───────────┘
Nitro ──> History
Nuxt ──> Nitro + Core/Provider runtime wiring
Vue UI ──> UI Core + private renderer
```

The user-facing workflows are Query, Track, and History. A default Scope is implicit. Named Scopes
created with `insight.scope(name)` are logical analysis boundaries, not Provider or backend names.

Core owns Scope resolution, bounded Adapter execution, abort handling, generic capability contracts,
public result construction, cross-cutting Quality, events, and a small
instrumentation port. It does not classify capabilities with a closed Metrics/Logs/Traces union.

A capability contract owns canonical query normalization, planning, exact deduplication,
deterministic merge, result typing, and optional History materialization. Provider adapters own
native validation, translation, authentication, pagination, and execution. Provider-native IDs and
cursors stay internal even when they are needed for grouping, instrumentation, or continuation.

The implemented canonical capabilities are:

- Metrics: typed metric and dimension selections, structured filters, and row-major data.
- Logs: finite ordered records with stable IDs, severity, service, trace correlation, and attributes.
- Traces: finite ordered traces and spans with stable IDs, status, service, timing, and attributes.

Adding a capability does not require changing Core's public query model.

## Dependency and package boundaries

- Core imports no Provider implementation, capability helper, History Engine, OpenTelemetry
  package, Integration, UI framework, DOM API, or renderer.
- Providers and capability helpers depend on Core. Provider implementations import no History,
  Integration, or UI layer.
- History and UI Core depend on Core independently; UI Core may also depend on Metrics.
- Integrations depend only on the layers they connect. There is no mandatory Integration interface.
- Nitro is not H3. Nuxt composes Nitro instead of duplicating Nitro-owned behavior.
- `@opentelemetry/api` is an optional peer reachable only from `insight-ts/opentelemetry`.
- Vue renderer code, TanStack Charts, d3-shape, and UI CSS are reachable only from
  `insight-ts/vue/ui`; the chart libraries are optional package peers.

The public package surface mirrors those boundaries:

- `insight-ts`: Core execution, generic contracts, Provider authoring, and errors.
- `insight-ts/metrics`, `/logs`, `/traces`: canonical contracts and adapter authoring helpers.
- Provider subpaths: native request translation and validation.
- `insight-ts/history`: the History Engine and Repository contract.
- `insight-ts/opentelemetry`: optional Core instrumentation adapter.
- `insight-ts/nitro` and `/nuxt`: runtime and application-framework integrations.
- `insight-ts/ui-core`: framework- and renderer-independent Metric result models.
- `insight-ts/vue`: browser-client integration only.
- `insight-ts/vue/ui`: optional Metric UI, renderer, and CSS.

The package uses tsdown to emit ESM, declarations, source maps, and explicit subpath entries. The
Vue UI entry and its public style subpath resolve to one minified stylesheet.
Publint, Are the Types Wrong, bundle checks, and packed-consumer tests protect the published surface.
Runtime dependencies remain external so optional entries stay isolated.

## Query and Provider contracts

Configured canonical capabilities become direct client methods such as `insight.metrics()`,
`insight.logs()`, and `insight.traces()`. Custom contracts use the same generic mechanism. One call
represents one logical query; applications use `Promise.all()` for independent concurrent work.
Queries never select a Provider or adapter.

Provider IDs use strict ASCII kebab-case, while Scope, adapter, and capability keys use lower
camel-case identifiers. Configuration is validated once and generated capability methods remain
prototype-safe. Core reserves names required by the client, including `scope`, `track`, `next`, and
`history`, and rejects collisions before I/O.

Capability normalization is deterministic and I/O-free. Concurrent direct calls enter one
client-local scheduler: equivalent adapter plans share queued or in-flight execution, and all native
adapter work uses one concurrency bound. Each logical caller keeps its own `AbortSignal`; shared
native work is cancelled only after no caller still needs it. Provider implementations may coalesce
compatible requests inside their own transports, but Providers have no generic batch-execution hook.
External I/O may scale with compatible Provider request groups, never with result rows, metrics, or
dimension values.

Shared Provider HTTP retries cover only transient fetch `TypeError`s and statuses 429, 500, 502, 503,
and 504. Backoff and `Retry-After` delays are bounded to 30 seconds and remain abortable.

Shared query shape is validated by the canonical contract. Provider implementations validate
native metrics, dimensions, filters, grain, ranges, pagination, limits, and credentials before
network I/O. Semantic Provider options such as data state remain normal top-level configuration;
optional execution tuning belongs under a Provider-specific `advanced` namespace.

Every result is serializable data. Core exposes canonical capability fields directly and adds a
`meta` field with `queriedAt`, conservative Quality, optional pagination, and capability metadata.
Adapters validate and canonicalize native results once. Capability composition reuses that canonical
data and performs cross-adapter work only when a semantic merge requires it. Adapter execution may
retain internal `data` envelopes and contribution topology. Provider sampling,
approximation, thresholding, freshness, partial results, and meaningful native limitations must not
be erased.

Applications continue pageable results with `insight.next(result)`. QueryResults remain plain
serializable data and carry only opaque, size-bounded state under `meta.pagination.next`. The state
binds the original query to its logical Scope, capability, single adapter, and current native
position; it never carries canonical result records or accumulated emitted IDs. Terminal results
omit pagination, and repeated native cursors are rejected.

Authentication is host-owned. In particular, Google Search Console accepts a
`getAccessToken` callback and stores no OAuth credentials or login routes.

Hosts also own OpenTelemetry SDKs, exporters, Collectors, sampling, and baggage. Instrumentation
attributes use the `insight.*` namespace and never contain raw queries, filters, event properties,
credentials, or PII.

### Metrics

A canonical Metric name has exactly one owner in a Scope. A query may combine Metrics from several
adapters, but selected dimensions and filters must be supported by every contributor. Incompatible
queries and duplicate ownership fail before I/O.

Metric queries select an `aggregate`, `rows`, or `both` projection, and results contain only the
selected fields. Queries without a grain or dimensions default to `aggregate`; grouped or time-series
queries default to `both`. Each row has one optional time, one optional dimensions object, and
selected Metric values under `row.values`. Adapters plan each projection natively, so a query-wide
`aggregate` is never inferred by reducing grouped or limited `rows`. One conservative Quality field
covers every native response used by the query. Values are `number | null`. Units and structured
aggregation describe semantics, not presentation.

History serves a Metric query only when it can reconstruct every requested projection. It adds
additive values and recomputes ratios from supporting Metrics; exact captured rows may retain
non-additive values. Stored data must match the capture grain and bucket timezone, and a coarser
capture never answers a finer query. Non-UTC row captures currently serve only their exact grain;
safe UTC rollups may use a coarser grain. A query that would require an unsafe or temporally
incompatible reconstruction executes wholly against the live Provider.

### Logs and Traces

Logs and Traces use portable common fields guided by OpenTelemetry conventions without exposing
OTel or Provider-native paths in ordinary queries. Arbitrary attributes retain non-portable data.
Terminal results merge deterministically and deduplicate by stable canonical IDs. Single-adapter
results support bounded continuation. Multi-adapter queries that require native continuation fail
with `UNSUPPORTED_OPERATION` until a bounded algorithm is justified by a concrete use case.

### Provider compatibility

The implemented Providers deliberately exercise different native shapes:

| Provider                         | Native model                                         | Quality and History constraints                                                                                                                        |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare Web Analytics         | GraphQL aggregate groups and aliased request groups  | Dynamic sampling remains visible; daily additive totals are History-safe.                                                                              |
| Cloudflare Analytics Engine      | SQL over a named dynamic dataset                     | Native sampling remains visible; the current adapter intentionally exposes only event count, time, and name.                                           |
| Cloudflare Workers Observability | Telemetry query and coalesced calculation APIs       | Logs, Traces, and Metrics retain sampling and partiality; finite pages may be materialized.                                                            |
| Google Search Console            | Search Analytics requests with sequential pagination | Top-row behavior, incomplete data, Pacific calendar boundaries, and execution limits remain visible; only additive and derived Metrics roll up safely. |

Future GA4, Matomo, Plausible, Umami, PostHog, Amplitude, Mixpanel, and similar Providers may have
dynamic schemas, thresholding, sampling, endpoint-specific limits, or Provider-owned event
semantics. The common vocabulary must accommodate those shapes without pretending all operations
are portable. Funnel, retention, unique, percentile, and Provider-defined results are never
silently combined.

## Track and trust boundaries

Applications share an event name/property schema, not transport, sessions, identity, consent,
autocapture, attribution, batching, or retry semantics. Provider-native browser trackers remain
Provider-owned and are not initialized twice when a host integration already owns them.

Server Track validates exact event names, required properties, property types, and extra fields,
then generates the ID, timestamp, and `origin`. Multiple configured destinations receive the same
validated event. Core captures optional trace context before opening its own tracking span. A
destination that rejects with a retryable `ProviderError` is retried once with the same event;
successful destinations are not repeated. Delivery is at least once rather than transactional:
destinations should handle a repeated event ID idempotently where their native API permits it, and a
new application call to `track()` creates a new operation and ID.

Browser delivery is best-effort, same-origin, size-bounded telemetry. The relay rejects unknown
events and properties, invalid types, client-supplied system fields, oversized bodies, and oversized
batches before delivery. The Nuxt module mounts the default `/api/_insight/events` relay and routes
each accepted event through canonical server Track; multiple-Scope applications select the relay
Scope explicitly. Client telemetry is not authoritative business state.

Analytics Engine writes one bounded native data point per validated event. Its index and blobs obey
native byte limits; property-level querying is outside the current contract.

## History

History is historical materialization, not a persistent query-result cache. Applications use
runtime-native caches such as Nitro Cache for request caching; Core shares only concurrent exact
work while it is queued or in flight.

History uses the same absolute half-open `{ from, to }` ranges as Query. Users select Scopes and
capability names, never internal adapter IDs or capability-specific strategy types. Capability-owned
materializers define capture queries, continuation, stable item identity, range support, bounded
read behavior, reconstruction, and optional partition-size hints.

The Engine owns coverage gaps, partition planning, complete page draining, deterministic segment
identity, live/History composition, bounded orchestration, explicit expiration, and idempotent
lifecycle operations. Coverage is committed only after a partition's pages drain. Complete empty,
provisional, and missing ranges remain distinct. A Provider-independent `provisionalFrom` boundary
splits stable coverage from a refreshable suffix; Provider Quality remains independent, so stable
partial results are not recaptured.

A `HistoryRepository` implements bounded `coverage`, `read`, `replace`, and `delete` operations.
Repositories isolate Scope, capability, and adapter targets and store opaque canonical items without
interpreting or silently reducing them. The generic contract does not prescribe storage keys or an
indexing strategy.

Nitro mounts History at `storage.insight` or `devStorage.insight`. Its private schema-v4 layout uses
a per-target partition index so range operations enumerate only overlapping partitions. Stored
layout is private and has no alpha migration guarantee. Nitro Tasks may invoke only
`insight.history.sync()` and are registered only when both History tasks and Nitro experimental task
support are explicitly enabled.

## Integrations and UI

Nuxt uses Nuxt Kit and documented Nuxt/Nitro hooks. Built-in Provider shortcuts and History
selection belong in `nuxt.config.ts`; Provider shortcuts append only to a single-Scope
`providers` configuration. Named Scopes construct Providers in `server/insight.config.ts`.
Credentials remain in private runtime configuration under top-level `runtimeConfig.<provider>`
keys. Nuxt does not scan UI source, inject UI CSS, import Vue UI, control Vapor, or serialize
secrets.

UI Core contains Metric result selection, transformations, formatting, domains, Quality notices,
and table models without framework, DOM, or renderer APIs. It keeps query-wide aggregates separate
from row models, parses row timestamps once, and retains exact model points while bounding
presentation series. Public UI accepts already queried data and performs no Provider I/O,
authentication, caching, or History work.

Framework UI integrations own markup, reactivity, lifecycle, and framework-native composition.
Chart renderers remain private. Vue components use `data` for data-bearing props, preserve selected
Metric order, expose semantic styling hooks, and compile the same SFC source for VDOM and Vapor
where practical. Cartesian charts and sparklines decimate only rendered geometry; exact model
points remain available in a semantic table, mounted on demand when the table would be very large.
No Vapor-specific public entry exists while the full UI still needs VDOM interop. Log and Trace
renderers remain application-local.

## Release model

Uppt v0.6.9 owns release versions, branches, tags, changelogs, and publication metadata. Package
versions are not edited manually on `main`. Stable and `alpha` Release PRs advance independently;
merging `release/v0.0.1-alpha.N` advances the alpha track, while the stable Release PR publishes the
stable version. CI and packed-package acceptance must pass on the generated Release PR before merge.
Workflow actions remain commit-pinned.

## Tests as executable product contracts

A pure internal rewrite must not require changes to Contract, Conformance, Protocol, Types, or
Consumer tests. If one of those suites must change, the change is a product or extension-contract
change and must be reviewed as such.

Tests are named and organized by responsibility:

- **Contract**: public runtime behavior, including Metrics, UI Core, pagination, and Track.
- **Conformance**: reusable checks for extension contracts such as `HistoryRepository`.
- **Protocol**: canonical query/result mappings to and from Provider-native requests and fixtures.
- **Types**: public TypeScript inference, valid/invalid usage, and export boundaries.
- **Integration**: interactions between public features and host/framework integrations.
- **Consumer**: emitted declarations, exports, runtime behavior, and builds from the packed tarball.
- **Live**: explicit opt-in checks against real Providers; never ordinary pull-request tests.
- **Internal**: implementation helpers and architecture-boundary checks that may change with a rewrite.
- **Performance**: benchmarks and regression guards, kept separate from semantic unit tests.

Contract, Conformance, Protocol, Types, and Consumer tests assert observable values and errors rather
than source shape. Provider Protocol tests use deterministic native fixtures and assert both request
translation and canonical response/Quality mapping. Complex optimized algorithms may use small,
deterministic test-only reference models where they provide a clearer oracle. Coverage is diagnostic,
not a substitute for these responsibilities or a global quality target.

Performance cases use Vitest 5's test-context benchmarks and JSON reporter. CI validates the report
and translates it to the pinned Bencher adapter's format, preserving benchmark names and units.
