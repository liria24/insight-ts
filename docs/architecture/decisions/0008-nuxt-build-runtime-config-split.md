# 0008: Nuxt build/runtime config split

Status: accepted

## Decision

`nuxt.config.ts` owns build-time declarations: project name, provider/resource identifiers,
archive policy, event definitions, and browser/relay options.
`server/analytics.config.ts` owns runtime-only State collection, custom adapters, provider
authorization, server credentials, and custom event delivery.

Event definitions have one source of truth. Server config has no `config?: AnalyticsConfig`.
Search Console authorization is namespaced as
`auth.searchConsole.getAccessToken`.

## Consequences

The module can generate browser code and relay routes only when events exist without evaluating
runtime secrets at build time. State collectors and token refresh callbacks remain server-only.
Plain TypeScript consumers continue to use `defineAnalyticsConfig({ events, state })`.
