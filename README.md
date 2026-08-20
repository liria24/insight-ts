# @liria24/analytics

A runtime-neutral TypeScript analytics SDK for querying Cloudflare Web Analytics,
Cloudflare Analytics Engine, and Google Search Console through one small report contract.

This repository is a Bun workspace containing the published SDK and its English Docus site.
The first release is under active development; public APIs may change before stability is
declared.

## Workspace

- `packages/analytics` — `@liria24/analytics`
- `apps/docs` — documentation site

```sh
bun ci
bun run check
bun run docs:dev
```

Dependencies must be added with `bun add` from the workspace that owns them.

## License

[MIT](./LICENSE)
