# Analytics SDK development

The governing product principle is:

> Broadly designed, narrowly implemented, minimally configured, runtime-native.

Consider future provider shapes before fixing a public contract, but never add unused abstractions
for hypothetical capabilities. Users should provide only information the SDK cannot derive.

## Commands and dependencies

- This is a Bun workspace. Use `bun ci` to reproduce the lockfile.
- Add every dependency with `bun add` from the workspace that owns it. Do not hand-edit
  dependency fields in `package.json`.
- Run `bun run check` before handing off changes.

## Architecture

Before changing Public API, Archive, Nuxt, Provider, or Release behavior, read
`docs/architecture/overview.md`, `docs/architecture/invariants.md`, the relevant ADRs under
`docs/architecture/decisions/`, and `docs/architecture/provider-compatibility.md`. If a change
reverses an accepted ADR, add a new ADR that explicitly supersedes it instead of rewriting the
accepted decision.

- Dependencies flow Integration -> Adapter -> Core. Never reverse this direction.
- Core owns analytics semantics and imports no provider, framework, or runtime package.
- Adapters translate provider requests and responses. They import no Nuxt or Vue code.
- Integrations only resolve configuration and connect runtime primitives to adapters.
- Keep public exports small. Internal registries, planners, and archive mechanics stay internal.
- Preserve provider sampling, approximation, freshness, and partial-result metadata.
- Prefer native runtime primitives such as Nitro Storage, H3, and Nitro Tasks over parallel
  infrastructure.
- Do not add speculative interfaces. Add the smallest implementation needed by a real capability.

## Query and provider semantics

- Resolve sources by explicit query source, then an explicit domain default, then a single valid
  candidate. Never select the first configured provider and never silently merge provider totals.
- Core validates shared schema. Adapters validate native metric, dimension, filter, grain, range,
  pagination, and provider-limit support before network I/O.
- Aggregation and cross-partition rollup are different. Add additive values, recompute derived
  ratios from supporting metrics, and reject unsafe non-additive rollups.
- External I/O may scale with provider-compatible request groups or archive partitions, not rows,
  points, dimensions, or individual metrics.
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

## Archive and maintenance

- Archive data is normalized plain JSON in `unstorage`, not a query cache.
- Monthly partitioning is an internal policy. Any index is advisory, never the sole data authority.
- Preserve report quality metadata, avoid live/archive overlap, and never infer dimensions absent
  from a materialization.
- Retention uses observation timestamps. Delete fully expired partitions and safely rewrite
  partially expired supported shapes.
- `analytics.maintenance.run()` owns maintenance semantics. Schedulers and the single Nuxt
  `analytics:maintenance` task only wake it; correctness must tolerate delay, duplication, and
  concurrency.
- Core and the Nuxt module do not implement a persistent result cache. Applications use their
  runtime-native cache; short execution-local memoization is allowed.

## Nuxt integration

- Prefer Nuxt Kit APIs, then documented Nuxt/Nitro hooks. Do not reach into private internals.
- Use H3 for HTTP, Nitro Storage for archives, Nitro Cache in applications, and Nitro Tasks for the
  optional maintenance bridge.
- Generate browser routes, imports, and tasks only when their capability is configured.
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
