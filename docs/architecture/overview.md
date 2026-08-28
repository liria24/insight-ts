# Architecture overview

The SDK follows one dependency direction:

```text
Integration -> Adapter -> Core
```

Core defines provider-independent queries, reports, source selection, rollup safety, event
schemas, Application State, and archive semantics. Adapters validate provider capability before
I/O and translate one shared query into provider-native requests and metadata-rich reports.
Integrations resolve host configuration and connect runtime primitives such as H3, Nitro Storage,
and Nitro Tasks.

The public package surface mirrors these boundaries:

- `@liria24/analytics` contains core contracts and execution.
- Provider subpaths contain Provider factories; Adapters remain internal execution primitives.
- `@liria24/analytics/provider` contains the custom Provider extension helper.
- `@liria24/analytics/nuxt` contains the build-time Nuxt module.
- `@liria24/analytics/nuxt/runtime` contains H3/Nitro runtime helpers.
- `@liria24/analytics/presentation` contains framework-independent report presentation models.
- `@liria24/analytics/vue` contains optional Vue browser-client integration.
- `@liria24/analytics/vue/ui` contains optional report-only presentation primitives.

Presentation depends only on Core report contracts. Vue UI depends on Presentation and treats
TanStack Charts as a private renderer. Core, browser, Nuxt, and the Vue integration entry do not
reach the renderer or UI stylesheet.

Configuration is split by evaluation time. `nuxt.config.ts` owns declarative resource
identifiers, event definitions, relay options, and archive policy. `server/analytics.config.ts`
owns runtime State collection, provider authorization callbacks, optional custom Providers, and
the custom event-delivery escape hatch.

Archive storage is normalized JSON in unstorage. It is historical materialization, not a result
cache. Provider coverage is backfilled on first maintenance when the Source declares its lookback;
later maintenance is incremental and safe to repeat.
