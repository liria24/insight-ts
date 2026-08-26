# 0004: Archive and maintenance

Status: accepted

## Decision

Archive data is monthly, versioned historical materialization, not a query cache. First
maintenance starts at explicit materialization coverage or an internal provider-recommended
lookback. Later runs refresh current coverage incrementally. State observations retain normalized
dimension rows.

## Consequences

Maintenance is idempotent and safe after delay, duplication, or concurrent wake-ups. Live and
archive ranges do not overlap. Additive values roll up, derived ratios are recomputed, and unsafe
non-additive results use live provider queries.
