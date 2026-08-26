# 0010: tsdown package build

Status: accepted

## Decision

The package uses tsdown to emit ESM, declarations, source maps, and explicit subpath entries.
publint and Are the Types Wrong run as build gates. Runtime dependencies remain external so each
entry preserves optional dependency boundaries.

## Consequences

The package manifest owns the public export map. Packed-consumer tests verify the tarball rather
than relying only on source imports. Entry changes require both build-surface and isolated
consumer checks.
