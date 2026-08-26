# 0005: Event routing

Status: accepted

## Decision

Applications share an event name/property schema, not provider transport semantics. Browser
events use a bounded same-origin relay. The server validates exact schema and creates IDs,
timestamps, and origin. Configured Analytics Engine bindings resolve a native sink automatically;
`eventHandler` remains the custom-destination escape hatch.

## Consequences

Browser telemetry is best effort and not authoritative business state. Provider-owned sessions,
identity, consent, autocapture, batching, and retry behavior remain provider-owned.
