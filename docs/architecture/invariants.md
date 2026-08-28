# Architecture invariants

## Dependency boundaries

- Core imports no Provider implementation, History Engine, Integration, UI framework, DOM API, or
  renderer.
- Provider implementations import Core and never import an Integration, History, or UI layer.
- History and UI Core import Core independently and do not depend on each other.
- Integrations depend only on the layers they connect; there is no mandatory common Integration
  interface or linear Adapter stack.
- Public entries do not re-export another entry's runtime graph accidentally.
- UI Core imports Core only and has no DOM, framework, renderer, Nitro, or Provider imports.
- UI renderer code and CSS are reachable only from `insight-ts/vue/ui`.
- Nitro is not H3. Nitro Integration imports no H3 API or request-context type.
- Nuxt composes Nitro Integration; it does not duplicate Nitro Storage or History task wiring.

## Capability, query, and report behavior

- Providers are optional capability collections; no common capability is mandatory.
- Report Source IDs are `${providerId}.${sourceKey}` and are never configured twice.
- Normal report access is capability-first and Source-explicit.
- Source declarations expose only implemented `summary`, `series`, `breakdown`, and `snapshot`.
- Ranges are absolute ISO timestamps with half-open `[from, to)` semantics.
- Filters use generic `field` names; provider-native query languages are not forced into one AST.
- Provider capability validation happens before network I/O.
- Additive metrics may be summed; derived ratios are recomputed; unsafe rollups are rejected.
- Provider sampling, approximation, freshness, partial status, and warnings survive merges.
- External I/O scales with Provider request groups or History range slices, never result rows.

## Nuxt configuration

- Built-in Provider enablement and History Source selection have one source of truth:
  `nuxt.config.ts`.
- Provider credentials and custom Provider construction remain private server runtime config.
- Built-in Provider credentials use top-level `runtimeConfig.<provider>` keys and never
  `runtimeConfig.insight.<provider>`.
- Search Console authentication is a host-owned `getAccessToken` callback.
- Generated History imports, tasks, and storage bridges exist only when History is configured.
- Existing Nitro storage and task entries are not overwritten.
- History uses `nitro.storage.insight` and `nitro.devStorage.insight`; missing mounts fail explicitly.
- Nitro Tasks are opt-in and never enable `experimental.tasks` implicitly.

## Events and UI

- Browser events are same-origin, bounded, schema-validated, and best effort.
- Event IDs, timestamps, and origin are server-owned.
- Vue components accept reports and never perform Provider I/O, caching, History work, or auth.
- Nuxt does not register optional Vue Insight components.
- Provider Quality and History Fidelity remain separate Core metadata.
- UI notices retain semantic Quality/Fidelity data before default text formatting.
- Vue VDOM and Vapor compile the same template-based SFC source; no Vapor-specific public entry or
  Nuxt Vapor switch is generated.
- Framework UI Integrations own markup, reactivity, lifecycle, and native composition. Formatting
  and semantic notice logic remain in UI Core.

## History

- Sources own schema, query semantics, rollup, freshness, History mode/grain, and safe breakdowns.
- The Engine owns gap detection, range slicing, Provider fetch, composition, reduction, fidelity,
  segment IDs, and idempotency.
- Repositories only implement `coverage`, `read`, and `write`; silent lossy processing is forbidden.
- Provider Quality and range-scoped History Fidelity are never collapsed into one flag.
- Schedulers only wake `insight.history.sync()` or `insight.history.capture()`.
