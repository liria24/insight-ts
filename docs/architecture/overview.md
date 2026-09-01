# Architecture overview

Core is the generic execution root. The project has independent branches rather than a mandatory
Integration/Adapter stack:

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

The user-facing workflows are Query, Track, and History. A default single Scope is implicit;
multiple Scopes are named logical analysis boundaries selected with `insight.scope(name)`. Scope
names do not describe backend topology.

Core knows generic capability contracts, Provider execution groups, `QueryResult`, cross-cutting
`QueryQuality`, events, and a generic instrumentation port. It never classifies capabilities with
a closed Metrics/Logs/Traces union. A contract owns canonical query normalization, adapter
planning, exact dedupe, deterministic merge, result typing, and optional History materialization.
Core owns lazy selection, Scope resolution, bounded execution, abort, and result envelopes.

The initial canonical contracts are:

- Metrics: string Metric/dimension selections with typed filters and row-major data.
- Logs: finite ordered records with canonical severity, service, trace correlation, and attributes.
- Traces: finite ordered traces/spans with canonical status, service, timing, and attributes.

Provider factories register internal adapters for these contracts. Adapters validate native
capability before network I/O and translate canonical queries into native requests. External I/O
may scale with compatible adapter request groups, never rows, points, metrics, or dimension
values. Internal adapter IDs remain available for execution, dedupe, instrumentation, History,
and opaque cursor state but do not appear in the query DSL or result metadata.

One Metric query can route selected Metrics to several adapters. Canonical Metric names have one
owner per Scope, cross-adapter dimensions and filters use the contributing adapters' capability
intersection, and rows merge deterministically by normalized time and dimensions. Logs and Traces
may merge multiple contributors, preserve stable canonical IDs, and expose one logical opaque
continuation.

The public package surface mirrors the boundaries:

- `insight-ts` contains generic Core contracts, execution, Provider authoring, and errors.
- `insight-ts/metrics`, `insight-ts/logs`, and `insight-ts/traces` contain canonical contracts and
  adapter authoring helpers.
- Provider subpaths contain native request translation and validation.
- `insight-ts/history` contains the generic History Engine and Repository contract.
- `insight-ts/opentelemetry` adapts Core instrumentation to the optional OTel API.
- `insight-ts/nitro` connects Nitro Storage and opt-in History tasks without importing H3.
- `insight-ts/nuxt` composes Nitro and adds Nuxt configuration and DX.
- `insight-ts/ui-core` contains Metric result models without framework or renderer APIs.
- `insight-ts/vue` contains optional Vue browser-client integration.
- `insight-ts/vue/ui` contains optional Metric result components.

Every Query result is serializable data. `meta.contributions` retains Quality at the field or
contribution level. Pageable results expose an opaque per-result `meta.pagination.next`; fetching
it re-queries only that logical result.

History consumes optional capability materialization protocols. It owns coverage gaps, complete
page draining, composition, reductions, Fidelity, idempotent materializations, and lifecycle.
Repositories provide bounded range operations and explicit deletion/replacement. Nitro supplies
the `storage.insight` mount. History is historical materialization, not a persistent query-result
cache.

UI Core depends on Core and Metric contracts. Vue UI treats TanStack Charts as private and accepts
already queried data. Log and Trace renderers remain application-local.
