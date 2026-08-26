# 0002: Provider capability model

Status: accepted

## Decision

The shared query is a common vocabulary, not a promise of universal support. Dataset descriptors
declare known metrics and dimensions; adapters validate native metrics, dimensions, filters,
grains, ranges, pagination, and limits before I/O.

## Consequences

Unsupported queries fail with actionable errors. Provider-specific metadata remains in report
quality and temporal fields. New provider shapes may influence shared contracts, but no interface
is added without a real implemented capability.
