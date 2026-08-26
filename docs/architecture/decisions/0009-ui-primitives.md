# 0009: UI primitives

Status: accepted

## Decision

The Vue entry exports report-only primitives: `AnalyticsStat`, `AnalyticsLineChart`, and
`AnalyticsBreakdownTable`. It does not export a dashboard composition. Components may select
metrics, format values, transform report rows, show empty/quality states, and expose slots.

## Consequences

Components never query analytics, call providers or endpoints, cache results, access archives, or
handle credentials. Chart behavior exposes small provider-independent props and transformed-data
slots rather than leaking `VueUiXyConfig`. Nuxt never auto-registers these optional components.
