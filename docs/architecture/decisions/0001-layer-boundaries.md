# 0001: Layer boundaries

Status: accepted

## Decision

Dependencies flow Integration -> Adapter -> Core. Core owns shared analytics semantics and has no
provider or framework imports. Adapters translate and validate provider behavior. Integrations
resolve host configuration and runtime primitives.

## Consequences

Core can be consumed without Nuxt, H3, Vue, or provider packages. Boundary tests inspect source
imports in CI. Cross-layer convenience re-exports are rejected when they pull runtime graphs into
the wrong public entry.
