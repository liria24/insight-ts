# 0021: Row-major Metric data

Status: accepted

Supersedes the canonical Metric result representation following ADR 0019. Its Metric helper,
History, Core independence, and UI boundary decisions remain accepted.

## Decision

`MetricData` stores scalar Metric values in `values` and optional row-major points in `points`.
Each point contains one shared `time`, one shared `dimensions` object, and the selected Metric
`values`. `defineMetricSource()` validates selected values and normalizes a point timestamp once
when materializing Provider output.

History segments use this representation as schema version 1. History reductions operate on
shared rows, and History materialization emits selected Metrics in the same shape. UI Core and
framework UI consume the rows directly instead of reconstructing them from per-Metric series.

## Consequences

Point metadata and timestamp work no longer scale with the number of selected Metrics. The
pre-release metric-major result is not retained through compatibility aliases or migrations.
