# 0015: TanStack Charts and framework-independent presentation

Status: accepted

Supersedes the renderer, UI entry, CSS loading, slot, and report-acceptance portions of ADR 0009
and ADR 0012. Their report-only and provider-independent principles remain accepted.

## Decision

Framework-independent metric selection, series transformation, timezone and number formatting,
axis domains, quality messages, and table formatting live in `insight-ts/presentation`.
This layer imports Core report contracts and no framework or renderer.

`insight-ts/vue` contains only `provideAnalytics()`, `useAnalytics()`, and Vue integration
types. Report components live in `insight-ts/vue/ui`. That UI entry imports its base CSS
as a side effect; the explicit `insight-ts/vue/ui/style.css` export is only an escape
hatch. The Nuxt module does not scan for UI usage, generate UI CSS, expose an `analytics.ui`
option, or import UI code.

TanStack Charts is the private Line/Area SVG renderer. The SDK owns an exact renderer version as
a dependency and keeps all renderer imports inside the Vue UI bundle. Public props and types stay
analytics-specific. Line and Area are separate components, and Area overlays an area plus upper
line for each metric without stacking.

UI component report types are strict: Stat accepts scalar, Line/Area accept series, and Breakdown
Table accepts table. The `ui` contract uses semantic keys and `string | readonly string[]` class
values. Slots replace semantic markup and do not receive resolved UI classes. Renderer replacement
slots are not public; custom renderers consume reports or Presentation models directly.

Charts use numeric timestamp domains so missing dates preserve proportional gaps. SSR emits the
complete SVG using a deterministic initial width, plus title, legend, quality/empty state, fixed
height, and an exact-value semantic table. Client hydration enhances the same markup.

## Consequences

Importing Vue UI includes its CSS, TanStack Charts, and Vue. Not importing Vue UI leaves those
assets out of Core, browser, Nuxt, and Vue-integration bundles. The package remains MIT licensed;
TanStack Charts is MIT and its implementation and CSS are not copied into this repository, so no
additional derived-code notice is required.
