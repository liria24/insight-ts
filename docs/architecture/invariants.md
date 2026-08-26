# Architecture invariants

## Dependency boundaries

- Core imports no adapter, integration, Nuxt, Nitro, H3, Vue, or provider package.
- Adapters import core only and never import an integration.
- Integrations may import adapters and core.
- Public entries do not re-export another entry's runtime graph accidentally.

## Query and report behavior

- Source resolution uses explicit query source, explicit domain default, or one valid candidate.
- Adapter capability validation happens before network I/O.
- Additive metrics may be summed; derived ratios are recomputed; unsafe rollups are rejected.
- Provider sampling, approximation, freshness, partial status, and warnings survive merges.
- External I/O scales with provider request groups or archive partitions, never result rows.

## Nuxt configuration

- Event definitions have one source of truth: `nuxt.config.ts`.
- Application State and provider authorization are runtime-only server config.
- Search Console authentication is `auth.searchConsole.getAccessToken`.
- Generated browser code, relay routes, maintenance tasks, and storage exist only when configured.
- Existing Nitro storage and task entries are not overwritten.

## Events and UI

- Browser events are same-origin, bounded, schema-validated, and best effort.
- Event IDs, timestamps, and origin are server-owned.
- Vue components accept reports and never perform analytics I/O, caching, archive work, or auth.
- Nuxt does not register optional Vue analytics components.

## Archive and maintenance

- Archive partitions are plain versioned JSON written through unstorage.
- Initial maintenance rescues known provider history before it expires.
- State observations preserve dimension rows.
- Retention uses observation timestamps and safely handles partial boundary partitions.
- Schedulers only wake `analytics.maintenance.run()`; maintenance owns correctness.
