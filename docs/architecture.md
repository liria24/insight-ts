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

Core owns Scope resolution, lazy selection, bounded execution, abort handling, generic capability
contracts, Provider request grouping, result envelopes, cross-cutting Quality, events, and a small
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
- Vue renderer code, TanStack Charts, and UI CSS are reachable only from `insight-ts/vue/ui`.

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

The package uses tsdown to emit ESM, declarations, source maps, and explicit subpath entries.
Publint, Are the Types Wrong, bundle checks, and packed-consumer tests protect the published surface.
Runtime dependencies remain external so optional entries stay isolated.

## Query and Provider contracts

Queries select canonical capabilities with `q.metrics()`, `q.logs()`, `q.traces()`, or another
registered contract. They never select a Provider or adapter. `insight.query()` is lazy: only the
descriptors returned by its selection callback execute.

Provider IDs use strict ASCII kebab-case, while Scope, adapter, and capability keys use lower
camel-case identifiers. Configuration is validated once and generated query builders remain
prototype-safe.

Capability normalization is deterministic and I/O-free. Equivalent normalized plans execute once,
and Provider implementations may batch compatible requests. External I/O may scale with compatible
Provider request groups, never with result rows, metrics, or dimension values. `AbortSignal` is an
execution option and reaches Provider execution.

Shared query shape is validated by the canonical contract. Provider implementations validate
native metrics, dimensions, filters, grain, ranges, pagination, limits, and credentials before
network I/O. Semantic Provider options such as data state remain normal top-level configuration;
optional execution tuning belongs under a Provider-specific `advanced` namespace.

Every result is serializable data. Core constructs the `QueryResult` envelope and validates shared
Quality. `meta.contributions` preserves merged field-level Quality without exposing adapter IDs.
Provider sampling, approximation, thresholding, freshness, partial results, and meaningful native
limitations must not be erased.

Pageable results expose only opaque `meta.pagination.next`. A cursor is size-bounded, bound to one
logical result and normalized query, and resumes only that result. Missing `next` is terminal; no
separate `hasMore` claim is inferred. Repeated native cursors are rejected.

Authentication is host-owned. In particular, Google Search Console accepts a
`getAccessToken` callback and stores no OAuth credentials or login routes.

Hosts also own OpenTelemetry SDKs, exporters, Collectors, sampling, and baggage. Instrumentation
attributes use the `insight.*` namespace and never contain raw queries, filters, event properties,
credentials, or PII.

### Metrics

A canonical Metric name has exactly one owner in a Scope. A query may combine Metrics from several
adapters, but selected dimensions and filters must be supported by every contributor. Incompatible
queries and duplicate ownership fail before I/O.

`MetricData` is row-major: each point has one optional time, one optional dimensions object, and
selected Metric values. Values are `number | null`. Units and structured aggregation describe
semantics, not presentation. Cross-partition rollup adds additive values, recomputes ratios from
supporting Metrics, and rejects unsafe percentile or other non-additive rollups.

### Logs and Traces

Logs and Traces use portable common fields guided by OpenTelemetry conventions without exposing
OTel or Provider-native paths in ordinary queries. Arbitrary attributes retain non-portable data.
Results merge deterministically, deduplicate by stable canonical IDs, and share the same bounded
continuation model.

### Provider compatibility

The implemented Providers deliberately exercise different native shapes:

| Provider                         | Native model                                         | Quality and History constraints                                                                                                                        |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Cloudflare Web Analytics         | GraphQL aggregate groups                             | Dynamic sampling remains visible; daily additive totals are History-safe.                                                                              |
| Cloudflare Analytics Engine      | SQL over a named dynamic dataset                     | Native sampling remains visible; the current adapter intentionally exposes only event count, time, and name.                                           |
| Cloudflare Workers Observability | Telemetry query and calculation APIs                 | Logs, Traces, and Metrics retain sampling and partiality; finite pages may be materialized.                                                            |
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
validated event and destination failure is observable to the caller.

Browser delivery is best-effort, same-origin, size-bounded telemetry. The relay rejects unknown
events and properties, invalid types, client-supplied system fields, oversized bodies, and oversized
batches. Client telemetry is not authoritative business state.

Analytics Engine writes one bounded native data point per validated event. Its index and blobs obey
native byte limits; property-level querying is outside the current contract.

## History

History is historical materialization, not a persistent query-result cache. Applications use
runtime-native caches such as Nitro Cache for request caching; only execution-local deduplication is
part of Core.

History uses the same absolute half-open `{ from, to }` ranges as Query. Users select Scopes and
capability names, never internal adapter IDs or capability-specific strategy types. Capability-owned
materializers define capture queries, continuation, stable item identity, range support, bounded
read behavior, reconstruction, and optional partition-size hints.

The Engine owns coverage gaps, partition planning, complete page draining, deterministic segment
identity, live/History composition, reduction, range-scoped Fidelity, bounded orchestration,
retention, and idempotent lifecycle operations. Coverage is committed only after a partition's pages
drain. Complete empty, provisional, missing, and reduced ranges remain distinct. Provider Quality
and History Fidelity are separate metadata.

A `HistoryRepository` implements bounded `coverage`, `read`, `replace`, and `delete` operations.
Repositories isolate Scope, capability, and adapter targets and store opaque canonical items without
interpreting or silently reducing them. The generic contract does not prescribe storage keys or an
indexing strategy.

Nitro mounts History at `storage.insight` or `devStorage.insight`. Its private schema-v3 layout uses
a per-target partition index so range operations enumerate only overlapping partitions. Stored
layout is private and has no alpha migration guarantee. Nitro Tasks may invoke only
`insight.history.sync()` and are registered only when both History tasks and Nitro experimental task
support are explicitly enabled.

## Integrations and UI

Nuxt uses Nuxt Kit and documented Nuxt/Nitro hooks. Built-in Provider enablement and History
selection belong in `nuxt.config.ts`; credentials and custom Provider construction remain in private
runtime configuration. Built-in credentials use top-level `runtimeConfig.<provider>` keys. Nuxt
does not scan UI source, inject UI CSS, import Vue UI, control Vapor, or serialize secrets.

UI Core contains Metric result selection, transformations, formatting, domains, Quality notices,
and table models without framework, DOM, or renderer APIs. Public UI accepts already queried data
and performs no Provider I/O, authentication, caching, or History work.

Framework UI integrations own markup, reactivity, lifecycle, and framework-native composition.
Chart renderers remain private. Vue components use `data` for data-bearing props, preserve selected
Metric order, expose semantic styling hooks, render accessible SSR output, and compile the same SFC
source for VDOM and Vapor where practical. No Vapor-specific public entry exists while the full UI
still needs VDOM interop. Log and Trace renderers remain application-local.

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
