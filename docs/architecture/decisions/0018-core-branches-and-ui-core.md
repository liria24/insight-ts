# 0018: Core branches and UI Core

Status: accepted

Supersedes the linear Integration → Adapter → Core model in ADR 0001, the Presentation path and
naming in ADR 0015, and the remaining Presentation terminology in ADR 0016. Historical Provider
translation and framework-independent UI principles remain accepted.

## Decision

Core is the dependency root for reports and History. Provider implementations, History, and UI
Core are independent branches over Core semantics; the browser client is standalone, and
Integrations depend only on the layers they connect. Provider-native request translation belongs
to Provider implementations rather than a separate public or mandatory Adapter layer.

Framework-neutral UI models and transformations live in `insight-ts/ui-core` and use `*Model`
terminology. Framework UI Integrations own markup, reactivity, lifecycle, and private renderers.
Vue VDOM and Vapor compile the same Vue SFC source. No Vapor-specific public entry exists while
the complete Vue UI still requires VDOM interop.

## Consequences

UI Core imports no framework, DOM, or renderer API. Nuxt remains independent from Vue UI and
Vapor. Future framework UIs may reuse UI Core without adopting Vue or TanStack Charts.
