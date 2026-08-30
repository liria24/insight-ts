---
name: insight-ts-development
description: Implement, review, or extend Insight.ts core queries, Providers, History, browser relay, Nitro/Nuxt integrations, and package exports without breaking its architectural boundaries.
---

# Insight.ts development

Use this skill for work in this repository that changes Insight.ts behavior or public APIs.

## Work from the contract inward

1. Read `AGENTS.md` and the package entry point involved in the change.
2. Before changing Public API, History, Nitro, Nuxt, Provider, or Release behavior, read
   `docs/architecture/overview.md`, `docs/architecture/invariants.md`, the relevant ADRs under
   `docs/architecture/decisions/`, and `docs/architecture/provider-compatibility.md`.
3. If a change reverses an accepted ADR, add a new ADR that explicitly supersedes it; never
   rewrite the accepted decision in place.
4. Keep Core independent. Provider implementations, History, and UI Core may depend on Core;
   Integrations depend only on the layers they connect.
5. Add dependencies only with `bun add`; never type dependency versions into a manifest.
6. Prefer runtime-native `fetch`, `URL`, `crypto`, and timers over wrappers.
7. Preserve report source, temporal, freshness, and quality metadata.
8. Resolve sources explicitly; never select configuration order or silently merge providers.

## Dependency boundaries

- Core imports no Provider implementation, History Engine, Integration, UI framework, DOM API, or
  renderer.
- Provider implementations translate provider-native requests and import no Integration or UI
  code. There is no separate public Adapter layer.
- History and UI Core each import Core, not one another.
- Nitro owns Nitro Storage and opt-in task wiring without importing H3. Nuxt composes Nitro.
- `insight-ts/vue` is browser integration only. `insight-ts/vue/ui` alone reaches UI CSS, Vue
  components, and TanStack Charts.

## Provider boundaries

- Core must not contain provider or Nuxt behavior.
- Provider implementations validate supported operations, metrics, dimensions, filters, grain,
  range, pagination, and limits before I/O.
- Nuxt resolves options and type wiring and composes Nitro-owned History behavior; it must not
  reimplement Provider queries or the History Repository.
- Built-in Nuxt Provider credentials use top-level `runtimeConfig.<provider>` keys, never
  `runtimeConfig.insight.<provider>`.
- Google Search Console authentication is an access-token callback. Do not persist OAuth credentials in this package.
- Validate query capability before network I/O and fail with an actionable error.
- Keep provider-native browser session, identity, consent, autocapture, batching, and retry behavior with the provider.

## Event trust boundary

- Browser delivery is best-effort, same-origin, size-bounded telemetry.
- Validate declared events and exact property names/types before delivery.
- Generate IDs, timestamps, and origin server-side; reject browser-supplied system fields.

## History behavior

- Sources own History mode/grain and safe rollup semantics.
- The Engine owns coverage gaps, range slicing, Provider fetches, composition, reduction, Fidelity,
  and idempotent segment identity.
- Repositories expose only `coverage`, `read`, and `write`; they never apply silent lossy changes.
- Keep Provider Quality and range-scoped History Fidelity separate through query results and UI
  Core models.
- Nitro uses the `insight` storage mount. Tasks are opt-in wake-ups for `sync()` and `capture()`.

## UI Core and Vue UI

- UI Core contains framework-, DOM-, and renderer-independent models and transformations.
- Framework UI Integrations own markup, reactivity, lifecycle, and native composition APIs without
  duplicating UI Core formatting or notice logic.
- Chart renderers remain private. Do not expose TanStack types or a renderer replacement API.
- Vue VDOM and Vapor compile the same template-based SFC source. Do not publish a Vapor entry while
  the complete UI still requires VDOM interop.

## Verification

Run `bun run format:check` for documentation-only changes. Otherwise run the narrowest relevant
test while iterating and `bun run check` before handoff. For package surface changes, also inspect
the packed tarball and test its exported entry points.

## Documentation follow-through

Before handoff, check whether the implementation changes public API, configuration, behavior,
entrypoints, UI components, Providers, or Integrations. Update `apps/docs` in the same change and
update the README where the user-facing contract changed; do not defer documentation work.
