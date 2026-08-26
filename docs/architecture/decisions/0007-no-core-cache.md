# 0007: No Core result cache

Status: accepted

## Decision

Core and the Nuxt module do not provide a persistent query-result cache. Archive storage preserves
historical coverage and is not reused as an opaque cache. Short execution-local memoization is
allowed when it only deduplicates work within one operation.

## Consequences

Applications use runtime-native caching such as Nitro Cache with application-specific keys,
freshness, invalidation, and authorization. The SDK avoids a second cache lifecycle and does not
confuse provider quality metadata with cache freshness.
