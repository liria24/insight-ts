# Insight.ts development

The governing product principle is:

> Broadly designed, narrowly implemented, minimally configured, runtime-native.

Consider future provider shapes before fixing a public contract, but never add unused abstractions
for hypothetical capabilities. Users should provide only information the SDK cannot derive.

## Commands and dependencies

- This is a Bun workspace. Use `bun ci` to reproduce the lockfile.
- Add every dependency with `bun add` from the workspace that owns it. Do not hand-edit
  dependency fields in `package.json`.
- Run `bun run format:check` for documentation-only changes. Run `bun run check` before handing
  off changes that affect source, configuration, packaging, or generated output.

## Architecture

Before changing Public API, History, Nitro, Nuxt, Provider, UI Core, or Release behavior, read
`docs/architecture/overview.md`, `docs/architecture/invariants.md`, the relevant ADRs under
`docs/architecture/decisions/`, and `docs/architecture/provider-compatibility.md`. If a change
reverses an accepted ADR, add a new ADR that explicitly supersedes it instead of rewriting the
accepted decision.

- Core owns Provider capability, Report Source, report, query, event, Quality, and Fidelity
  semantics. It imports no Provider implementation, History Engine, framework, renderer, or
  runtime package.
- There is no mandatory linear Integration/Adapter stack. Provider implementations, History, and
  UI Core depend on Core independently. Integrations depend only on the layers they connect.
- Provider implementations translate native requests and validate provider-specific capability
  before network I/O. They import no Integration or UI code.
- Keep public exports small. Internal registries, planners, Provider request grouping, and History
  mechanics stay internal.
- Preserve provider sampling, approximation, freshness, and partial-result metadata.
- Prefer host-native primitives such as Nitro Storage and opt-in Nitro Tasks over parallel
  infrastructure. Do not assume Nitro uses H3.
- Do not add speculative interfaces. Add the smallest implementation needed by a real capability.

### Provider and Integration definitions

- A Provider is a data source or operation target: Cloudflare, Google Search Console, Sentry,
  PostHog, Uptime Kuma, or an application-defined Provider.
- An Integration connects Insight.ts to a host ecosystem. Runtime Integrations include Nitro;
  server-framework Integrations include Hono and Elysia; application-framework Integrations include
  Nuxt, Next.js, SvelteKit, and Astro; UI Integrations include Vue, React, Svelte, and Solid.
- Nitro is not H3. Nitro-owned storage and task wiring belongs to the Nitro Integration and must
  remain usable with an H3, Hono, Elysia, or Web-standard server entry.
- Nuxt composes the Nitro Integration instead of reimplementing Nitro-owned behavior.
- Do not create a common mandatory Integration capability interface, promote host primitives into
  Core, or add pair-specific Integrations such as `nitro-hono`.
- UI Integrations and application-framework Integrations remain independently optional.
- UI Core contains framework- and renderer-independent UI models and transformations. It imports
  no Vue, React, Svelte, Solid, DOM, or chart-renderer API.
- Framework UI Integrations own markup, reactivity, lifecycle, and framework-native composition;
  keep semantic behavior consistent without forcing identical framework APIs.
- Chart renderers remain private to each framework UI Integration. Do not duplicate formatting or
  semantic model logic outside UI Core.
- Vue VDOM and Vapor are compilation targets of the same Vue SFC source, not separate UI
  architectures. Keep that source compilable by both when practical.
- Do not publish a Vapor-specific entry until the complete Vue UI no longer requires VDOM interop.

## Query and provider semantics

- Report access is Source-explicit through `insight.reports(sourceId)`. Never infer a Provider from
  configuration order and never silently merge Provider totals.
- Core validates shared report and query shape. Provider implementations validate native metric,
  dimension, filter, grain, range, pagination, and provider-limit support before network I/O.
- Aggregation and cross-partition rollup are different. Add additive values, recompute derived
  ratios from supporting metrics, and reject unsafe non-additive rollups.
- External I/O may scale with provider-compatible request groups or History range slices, not
  rows, points, dimensions, or individual metrics.
- Keep authentication host-owned. In particular, Search Console receives a `getAccessToken`
  callback and never stores OAuth credentials or creates login/callback routes.

## Events and trust

- Unify the application event API and schema, not provider transport, sessions, identity,
  autocapture, consent, attribution, batching, or retry semantics.
- Use a provider's supported native browser tracker when its behavior matters. Do not initialize a
  second copy when a host module or Nuxt Scripts already owns it.
- A browser relay is same-origin and bounded. Reject unknown events, unknown properties, bad types,
  extra system fields, oversized bodies, and oversized batches.
- Generate event IDs, timestamps, and `origin` on the server. Client telemetry is best effort and is
  not authoritative business state.

## History

- Report Sources own schema, query semantics, aggregation/rollup, freshness, History mode/grain,
  and History-safe breakdowns.
- The History Engine owns range slicing, coverage gaps, Provider fetches, safe rollup,
  live/History composition, reductions, Fidelity, and idempotent segment identity.
- A History Repository implements only `coverage`, `read`, and `write`. Storage keys,
  serialization, planning, and lossy reduction are not repository responsibilities.
- Range sync fetches missing or provisional intervals. Snapshot capture stores observations and
  History exposes them as series.
- Provider Quality and range-scoped History Fidelity remain separate metadata. Repositories must
  not apply silent lossy processing.
- Core and Integrations do not provide a persistent query-result cache. Applications use their
  runtime-native cache; short execution-local memoization is allowed.

## Nuxt integration

- Prefer Nuxt Kit APIs, then documented Nuxt/Nitro hooks. Do not reach into private internals.
- Nuxt composes the Nitro Integration instead of reimplementing History storage or task wiring.
- Built-in Provider enablement and History Source selection belong in `nuxt.config.ts`; secrets
  and custom Provider construction remain in private runtime configuration.
- Built-in Provider credentials use top-level `runtimeConfig.<provider>` keys. Do not nest
  credentials under `runtimeConfig.insight`.
- History uses `nitro.storage.insight` or `nitro.devStorage.insight`. Nitro Tasks are registered
  only when History tasks and Nitro's experimental task support are both explicitly enabled.
- Nuxt does not scan UI source, inject UI CSS, import Vue UI, control Vapor, or reference TanStack
  Charts.
- Never serialize API tokens or OAuth credentials into generated client or build-time templates.

## Testing

- Test observable behavior, external I/O counts, packed-package consumption, and trust boundaries.
- Do not substitute source-shape assertions for behavior tests. Verify the values and errors a
  consumer actually receives.
- A query must not issue I/O per result row, metric, or dimension value.
- Tests use deterministic fixtures by default. Live provider tests must be explicit opt-ins.

## Licensing

The project is MIT licensed. Verify runtime dependency licenses before adding them, prefer
permissive licenses, and preserve required notices when deriving substantial third-party code.
Provider API terms and software licenses are separate concerns.
