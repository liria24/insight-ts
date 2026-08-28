# 0017: Alpha release track

Status: accepted

Supersedes the prerelease input described in ADR 0011 while Insight.ts is in alpha.

## Decision

The uppt Release PR job always receives `prerelease: alpha`. Main pushes therefore continue the
`0.0.1-alpha.N` track instead of opening a stable `0.0.1` Release PR. Uppt continues to own
versions, release branches, tags, and publication metadata.

## Consequences

Remove the fixed prerelease value when promoting Insight.ts to stable. Package versions remain
unchanged on main outside uppt's generated Release PR.
