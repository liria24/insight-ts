# 0006: Analytics Engine event format

Status: accepted

## Decision

Analytics Engine writes one data point per validated event. The index is `name:<event-name>`.
Blobs contain event name, JSON properties, and origin. Event timestamp and identifier remain in
the shared server event but are not projected into unsupported Analytics Engine fields.

## Consequences

The adapter enforces native index and blob byte limits before writing. Property-level Analytics
Engine querying is outside the alpha scope; the read adapter exposes only event count with time
or name breakdowns.
