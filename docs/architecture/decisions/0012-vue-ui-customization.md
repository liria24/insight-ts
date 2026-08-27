# 0012: Vue UI customization

Status: accepted

## Decision

Analytics Vue primitives use one provider-independent customization contract based on root
`class`, component-specific `ui` keys, named slots, and `data-slot` attributes. Named slots receive
the resolved `ui` object. Class values are passed directly to Vue class binding; the package does
not parse or merge utility classes and does not depend on Tailwind CSS, Tailwind Variants, or Nuxt
UI.

Vue Data UI remains an internal renderer for plotting, lines, axes, grids, and pointer
calculation. Analytics SDK owns title, legend, tooltip, quality, empty states, time formatting,
axis options, and transformed slot data. Renderer-specific config, dataset, theme, and slots are
not public API.

SVG styling uses semantic `--analytics-*` variables with optional fallbacks to matching Nuxt UI
semantic variables. Plain Vue consumers import `@liria24/analytics/vue/style.css` manually. The
Nuxt module defaults to build-time component detection and generates a watched stylesheet
template; it can also always inject or disable styles explicitly.

Vue UI documentation is organized around the Analytics SDK public API: overview, usage, styling,
slots, and API. Renderer configuration is not documented as an application customization path.

## Consequences

Consumers can apply Tailwind, UnoCSS, CSS Modules, plain CSS, or another class system without
adding one to the SDK dependency graph. Components retain stable style targets even when internal
markup or the chart renderer changes. Nuxt may inject CSS for optional components but continues to
avoid auto-registering them, preserving ADR 0009.
