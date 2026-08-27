# 0013: Provider and Source public API

Status: accepted

Supersedes the public-contract portions of 0002 and the runtime configuration shape in 0008.
Their capability-validation and build/runtime separation decisions remain accepted.

## Decision

The public model is Provider → Source → Query → Report. `createAnalytics()` accepts Providers;
Adapters remain internal execution primitives. Public Source descriptors use object maps for
metrics and dimensions, include archive metadata directly, and are listed by
`analytics.sources()`. `defineAnalyticsProvider()` supplies report factories so extensions do not
construct report metadata or implement internal Adapter contracts.

Queries accept only absolute ISO `from` and `to` timestamps with half-open `[from, to)` semantics.
Applications own relative date presets. Domain and Source clients expose `summary`, `series`, and
`breakdown`; `analytics.query()` remains the advanced escape hatch.

Nuxt keeps resource declarations in `nuxt.config.ts`. Server configuration groups credentials by
Provider and accepts request-scoped `customProviders`. Missing runtime credentials surface as
`AnalyticsError` with `CONFIGURATION_MISSING`.

## Consequences

Provider-specific native names such as an Analytics Engine dataset remain inside Provider options,
but dataset and Adapter terminology is not exposed as the normal SDK contract. Archive and
provider requests share the same interval boundary, adjacent ranges do not overlap, and relative
calendar behavior stays outside Core.
