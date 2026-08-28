# 0016: Insight.ts capability, History, and Integration architecture

Status: accepted

Supersedes the public naming and Source contract in ADR 0013, the Archive Engine and persistence
contract in ADR 0003 and ADR 0004, and the Nuxt runtime composition in ADR 0008. Supersedes only
the package and symbol names in ADR 0015; its Presentation separation, TanStack Charts renderer,
SSR, accessibility, styling, and bundle-isolation decisions remain accepted.

## Decision

The npm package is `insight-ts`. Alpha compatibility aliases are not retained. Providers are
optional capability collections and custom Providers use `defineProvider()`. Report Source IDs
derive once as `${providerId}.${sourceKey}`. The normal API is capability-first and Source-explicit:
`insight.reports(source)`. A Source exposes only implemented `summary`, `series`, `breakdown`, and
`snapshot` operations. Ranges use absolute ISO half-open `[from, to)` intervals.

Source declarations own metrics, dimensions, query semantics, rollup, freshness, History mode and
grain, and History-safe breakdowns. The History Engine owns sync/capture planning, coverage gaps,
Provider fetches, safe rollup, live/History composition, lossy reduction, range-scoped Fidelity,
and idempotent segment identity. A History Repository exposes only `coverage`, `read`, and `write`.
Provider Quality and History Fidelity remain separate report metadata.

`insight-ts/nitro` connects the well-known `storage.insight` and `devStorage.insight` mounts to the
History Repository. Nitro Tasks are an explicit opt-in bridge named `insight:history:sync` and
`insight:history:capture`; the Integration never enables experimental tasks. Nitro imports no H3
API. `insight-ts/nuxt` composes this Nitro behavior and adds only Nuxt lifecycle, options, runtime
configuration, auto-imports, and type wiring.

`insight-ts/ui-core` remains framework-neutral and preserves known metric and dimension keys. Vue browser
integration remains separate from `insight-ts/vue/ui`. The UI entry alone imports base CSS,
TanStack Charts, and renderer code. Components are renamed to `InsightStat`, `InsightLineChart`,
`InsightAreaChart`, and `InsightBreakdownTable`; CSS variables use the `--insight-*` namespace.
Vue VDOM and Vapor compile the same template-based SFC source. A Vapor-specific public entry is
deferred while TanStack Charts still requires VDOM interop, and Nuxt does not control Vapor.

## Consequences

Unused Providers, History, Nitro, Nuxt, Vue UI, CSS, and renderer code can be excluded by normal
entrypoint tree shaking. Current-value Providers use `snapshot()` and History capture rather than
a special State API. Repositories cannot silently reduce data or inherit query-planning work.
Future Hono, Elysia, React, Svelte, Solid, Astro, and application-framework Integrations can reuse
Core, History, and Presentation without pair-specific Integration packages.
