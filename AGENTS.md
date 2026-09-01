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

`docs/architecture.md` is the single source of truth for the current architecture. Read it before
changing public API, Provider, History, Integration, UI Core, packaging, testing strategy, or
Release behavior. Update it in the same change whenever architecture or an invariant changes.

- Trace a public contract through its implementation, tests, documentation, and package entry.
- Keep public exports small and implementation mechanics internal.
- Prefer host-native primitives and the smallest implementation required by a real capability.
- Preserve trust-boundary validation and Provider Quality, freshness, and History Fidelity.

## Testing

- Follow the suite responsibilities in `docs/architecture.md` and
  `packages/insight-ts/test/README.md`.
- Test observable behavior, external I/O counts, packed-package consumption, and trust boundaries.
- Do not substitute source-shape assertions for behavior tests. Verify the values and errors a
  consumer actually receives.
- A query must not issue I/O per result row, metric, or dimension value.
- Tests use deterministic fixtures by default. Live provider tests must be explicit opt-ins.

## Licensing

The project is MIT licensed. Verify runtime dependency licenses before adding them, prefer
permissive licenses, and preserve required notices when deriving substantial third-party code.
Provider API terms and software licenses are separate concerns.

## Documentation

- When a change affects public API, configuration, behavior, entrypoints, UI components, Providers,
  or Integrations, update `apps/docs` in the same change and update the README when it is affected.
  Do not defer documentation updates to separate work.
