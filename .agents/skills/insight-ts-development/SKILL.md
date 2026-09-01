---
name: insight-ts-development
description: Implement, review, or extend Insight.ts core queries, Providers, History, browser relay, Nitro/Nuxt integrations, and package exports without breaking its architectural boundaries.
---

# Insight.ts development

Use this skill for work in this repository that changes Insight.ts behavior or public APIs.

## Work from the contract inward

1. Read `AGENTS.md`, `docs/architecture.md`, and the package entry point involved in the change.
2. Trace the public contract through its implementation, tests, documentation, and export surface.
3. Reuse existing contracts and runtime-native primitives before adding code or dependencies.
4. Implement the smallest real capability without speculative interfaces or compatibility aliases.
5. Update `docs/architecture.md` in the same change whenever architecture or an invariant changes.
6. Add dependencies only with `bun add`; never type dependency versions into a manifest.

## Git and pull requests

- Start ordinary work branches from `main`, open a reviewable GitHub PR, and squash merge by
  default.
- Use a descriptive Conventional Commits PR title (`feat:`, `fix:`, `perf:`, `refactor:`, `docs:`,
  or `chore:`) that is suitable as the commit message left on `main` after squashing.
- Target `main` unless the work is an explicit stacked PR. For a stack, branch the first PR from
  `main` and each later PR from its immediate predecessor.
- After a preceding PR is squash merged, rebase or retarget later branches as needed and verify
  that each PR contains only its own change.

## Verification

Run `bun run format:check` for documentation-only changes. Otherwise run the narrowest relevant
test while iterating and `bun run check` before handoff. Follow the suite responsibilities in
`docs/architecture.md` and `packages/insight-ts/test/README.md`. For package surface changes, also
inspect the packed tarball and test its exported entry points.

## Documentation follow-through

Before handoff, check whether the implementation changes public API, configuration, behavior,
entrypoints, UI components, Providers, or Integrations. Update `apps/docs` in the same change and
update the README where the user-facing contract changed; do not defer documentation work.
