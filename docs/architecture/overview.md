# Architecture overview

Core is the generic execution root. The project has independent branches rather than a mandatory
Integration/Adapter stack:

```text
Provider implementations ───────────────┐
Metric helpers ─────────────────────────┤
History ────────────────────────────────┼──> Core generic Source execution
OpenTelemetry adapter ──────────────────┤
UI Core ──> Metric helpers + Core ──────┘
Nitro ──> History
Nuxt ──> Nitro + Core/Provider runtime wiring
Vue UI ──> UI Core + private renderer
```

Core knows `Provider`, `Source<TQuery, TNormalized, TData, TMeta>`, `QueryResult`, cross-cutting
`QueryQuality`, events, and a generic instrumentation port. It never classifies Source data as
analytics, metrics, logs, traces, profiles, funnels, or billing. A Source owns query semantics,
normalization, its exact dedupe key, execution, and result metadata. Core owns lazy multi-Source
selection through typed Provider/Source accessors, Provider grouping, bounded execution, dedupe,
abort, and result envelopes. Canonical `${provider.id}.${sourceKey}` IDs remain the internal identity.

The public package surface mirrors the boundaries:

- `insight-ts` contains generic Core contracts, execution, `defineSource()`, and `defineProvider()`.
- `insight-ts/metrics` contains structured Metric semantics and typed `where` helpers.
- Provider subpaths contain native request translation and validation.
- `insight-ts/history` contains the Metric History strategy and small Repository contract.
- `insight-ts/opentelemetry` adapts Core instrumentation to the optional OTel API.
- `insight-ts/nitro` connects Nitro Storage and opt-in sync tasks without importing H3.
- `insight-ts/nuxt` composes Nitro and adds Nuxt configuration and DX.
- `insight-ts/ui-core` contains Metric result models without framework or renderer APIs.
- `insight-ts/vue` contains optional Vue browser-client integration.
- `insight-ts/vue/ui` contains optional Metric result components.

Provider implementations validate native capability before network I/O. Their external I/O may
scale with compatible request groups, never rows, points, metrics, or dimension values. Analytics
and product Sources do not adopt OTel semantics; observability Sources use OTel semantic
conventions and UCUM units where applicable without using OTel as storage or query shape.

Built-in Provider factories are their canonical consumer API and preserve the exact configured
Source map. Provider IDs use strict ASCII kebab-case; the query DSL derives a camelCase accessor
once when `createInsight()` initializes. Custom Provider authors use the root authoring helpers.

History consumes an optional Metric Source strategy. It owns coverage gaps, normal execution
fetches, composition, safe rollup, reduction, Fidelity, and idempotent segments. Repositories only
report coverage and read or write segments. Nitro supplies the `storage.insight` mount. History is
historical materialization, not a persistent query-result cache.

UI Core depends on Core and Metric contracts. Vue UI treats TanStack Charts as private and accepts
already queried `data`. Source-owned logs, traces, funnels, and billing use application-local
renderers until stable contracts justify dedicated public UI.
