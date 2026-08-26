# 0003: unstorage and Nitro Storage

Status: accepted

## Decision

Core archive persistence uses the unstorage `Storage` contract and normalized plain JSON.
Nuxt supplies Nitro Storage to that contract. R2 uses Nitro's
`cloudflare-r2-binding` driver and a host binding identifier.

## Consequences

Core does not know Nitro or R2. Applications can choose another unstorage driver. The Nuxt module
merges storage through `nitro:config` and never overwrites an existing storage key.
