# 0017: Alpha release track

Status: accepted

Clarifies the prerelease behavior described in ADR 0011 while Insight.ts is in alpha.

## Decision

The release workflow maintains stable and alpha Release PRs in parallel. The stable Release PR job
runs without a prerelease identifier, while the alpha Release PR job receives `prerelease: alpha`.
Main pushes therefore update both the next stable release candidate and the `0.0.1-alpha.N` track.
Merging an alpha Release PR advances the alpha track; merging the stable Release PR publishes the
corresponding stable version. Uppt continues to own versions, release branches, tags, and publication
metadata.

## Consequences

Alpha releases do not require changing the stable Release PR flow, and preparing a stable release
does not require removing the alpha Release PR job. Package versions remain unchanged on main outside
uppt's generated Release PRs.
