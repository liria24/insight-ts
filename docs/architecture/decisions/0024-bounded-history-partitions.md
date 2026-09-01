# 0024: Bounded History partitions

Status: accepted

Extends the generic History materialization decision in ADR 0023 and supersedes its Nitro
Storage layout while retaining its repository contract and schema-version-2 segments.

## Decision

History materializers may provide an internal time-partition size. The History Engine combines
those boundaries with policy boundaries, drains native pagination within one partition, and
commits that partition before fetching the next. Materializers remain capability-owned hints;
partition planning, coverage, reductions, Fidelity, and idempotent replacement remain Engine
responsibilities.

The Nitro repository uses a schema-version-3 private storage prefix and a per-target partition
index. Each index entry names an exact stored range whose item and coverage keys share a prefix.
Coverage, read, replacement, and deletion load the index and enumerate only overlapping
partition prefixes. Bounded reads merge key metadata deterministically across those partitions
and use a stable key frontier as their cursor. Range mutations retain non-overlapping segments
that share a physical partition and discard that partition's stale coverage marker.

The generic repository API is unchanged. Repositories may use a different indexing strategy as
long as they preserve the same observable coverage, ordering, pagination, replacement, and
corruption behavior.

## Consequences

Large Log and Trace synchronization no longer retains an unbounded full-range event set in
memory, and narrow Nitro reads do not scan unrelated History item keys. Nitro's alpha storage
layout intentionally starts clean at `history:v3`; no migration from the private v2 layout is
provided. A partition still drains all of its native pages before coverage is committed, so the
materializer's partition size is the memory-bound tuning point.
