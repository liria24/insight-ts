# 0023: Generic History materialization

Status: accepted

Supersedes the Metric-only History strategy and `coverage`/`read`/`write` repository contract in
ADR 0016 and ADR 0019, and the schema-version-1 Metric segment decision in ADR 0021. Implements
the generic History direction accepted in ADR 0022.

## Decision

History is one workflow across canonical capabilities. Users may select Scopes and capability
names, but never Provider adapter IDs or capability-specific History strategy types. Query and
History use the same absolute half-open `{ from, to }` ranges.

Each adapter may expose an internal materializer owned by its canonical capability. The
materializer defines capture queries, continuation draining, stable item identity, range support,
bounded-read behavior, and reconstruction of canonical data. Metrics retain aggregation-aware
rollup. Logs and Traces retain stable IDs and ordered pagination. Core treats the protocol as an
open adapter operation and does not classify capability names.

The Engine owns coverage gaps, complete continuation draining before coverage is committed,
deterministic segment IDs, policy reductions, range-scoped Fidelity, bounded orchestration, and
lifecycle. Empty full-fidelity segments record that a completed range had no data. Provisional or
missing coverage is reported as `not-preserved`; reduced data records its transformations.
Provider Quality remains separate.

A repository exposes `coverage`, bounded `read`, `replace`, and `delete`. Schema-version-2
segments are partitioned by Scope, capability, and internal adapter. Repositories store opaque
canonical items and metadata without interpreting, merging, or reducing them.

## Consequences

One `createHistory()` configuration supports Metrics, Logs, Traces, and future capability
materializers. Event-like queries can page through retained data without loading a whole range.
Nitro Storage can compact or expire data through explicit replacement and deletion. Changing
Provider topology may require a resync because internal adapter identity is part of materialized
storage, while it remains absent from the public query model.
