# Architecture overview

Core is the dependency root for reports and History. The current modules form independent branches
rather than one linear Integration/Adapter stack:

```text
Providers ───────────────┐
History ─────────────────┼──> Core
UI Core ─────────────────┘
Nitro ──> History
Nuxt ──> Nitro + Core/Provider runtime wiring
Vue ──> Browser Integration
Vue UI ──> UI Core + Core + private renderer
```

Core defines capability contracts, typed Report Sources, report metadata, rollup safety, and
History extension semantics. Provider implementations validate native capability before I/O and
translate Source queries into provider-native requests. Integrations connect only the host
primitives they own without promoting those primitives into Core.

The public package surface mirrors these boundaries:

- `insight-ts` contains Core contracts and execution.
- Provider subpaths contain Provider factories and their native request translation.
- `insight-ts/provider` contains the custom `defineProvider()` extension helper.
- `insight-ts/history` contains the History Engine, reductions, and small Repository contract.
- `insight-ts/nitro` connects Nitro Storage and opt-in Nitro Tasks without importing H3.
- `insight-ts/nuxt` composes the Nitro Integration and adds only Nuxt configuration and DX.
- `insight-ts/ui-core` contains framework- and renderer-independent UI models.
- `insight-ts/vue` contains optional Vue browser-client integration.
- `insight-ts/vue/ui` contains optional report-only Vue components.

UI Core depends only on Core report contracts. Vue UI depends on UI Core and treats TanStack
Charts as a private renderer. Core, browser, History, Nitro, Nuxt, UI Core, and the Vue integration
entry do not reach the renderer or UI stylesheet.

Providers are optional capability collections. Implemented Report Sources expose only the
operations they support: `summary`, `series`, `breakdown`, or `snapshot`. Source IDs derive from
the Provider ID and Source key. Provider-native query languages remain explicit escape hatches.

History consumes Source-owned schema, query, rollup, freshness, and History declarations. The
Engine owns planning, gaps, composition, reduction, fidelity, and idempotency; a Repository only
reports coverage and reads or writes segments. Nitro supplies the well-known `storage.insight`
mount. History is historical materialization, not a result cache.
