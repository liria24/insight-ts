---
name: analytics-sdk-development
description: Implement, review, or extend @liria24/analytics core queries, provider adapters, archives, browser relay, Nuxt integration, and package exports without breaking its architectural boundaries.
---

# Analytics SDK development

Use this skill for work in this repository that changes analytics behavior or public APIs.

## Work from the contract inward

1. Read `AGENTS.md` and the package entry point involved in the change.
2. Before changing Public API, Archive, Nuxt, Provider, or Release behavior, read
   `docs/architecture/overview.md`, `docs/architecture/invariants.md`, the relevant ADRs under
   `docs/architecture/decisions/`, and `docs/architecture/provider-compatibility.md`.
3. If a change reverses an accepted ADR, add a new ADR that explicitly supersedes it; never
   rewrite the accepted decision in place.
4. Keep the dependency direction `integration -> adapter -> core`.
5. Add dependencies only with `bun add`; never type dependency versions into a manifest.
6. Prefer runtime-native `fetch`, `URL`, `crypto`, and timers over wrappers.
7. Preserve report source, temporal, freshness, and quality metadata.
8. Resolve sources explicitly; never select configuration order or silently merge providers.

## Provider boundaries

- Core must not contain provider or Nuxt behavior.
- Adapters translate the shared query contract into one provider request and return a shared report.
- Nuxt resolves secrets, routes, scheduled work, and runtime storage; it must not reimplement queries.
- Google Search Console authentication is an access-token callback. Do not persist OAuth credentials in this package.
- Validate query capability before network I/O and fail with an actionable error.
- Keep provider-native browser session, identity, consent, autocapture, batching, and retry behavior with the provider.

## Event trust boundary

- Browser delivery is best-effort, same-origin, size-bounded telemetry.
- Validate declared events and exact property names/types before delivery.
- Generate IDs, timestamps, and origin server-side; reject browser-supplied system fields.

## Archive behavior

- Store plain JSON through `unstorage`.
- Merge archive and live results without double-counting their boundary.
- Never silently remove quality warnings or turn approximate values into exact ones.
- Keep maintenance idempotent and safe to retry.
- Base retention on observation time and handle partial boundary partitions without deleting valid observations.
- Treat schedulers as wake-ups only and application caches as framework concerns.

## Verification

Run the narrowest relevant test while iterating, then run `bun run check` before handoff. For package surface changes, also inspect the packed tarball and test its exported entry points.
