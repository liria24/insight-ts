# insight-ts

A runtime-neutral TypeScript SDK for typed Provider capabilities, History, and optional host/UI
Integrations. Built-in Providers currently cover Cloudflare and Google Search Console.

This repository is a Bun workspace containing the published SDK and its English Docus site.
The first release is under active development; public APIs may change before stability is
declared.

## Workspace

- `packages/insight-ts` — npm package
- `apps/docs` — documentation site

```sh
bun ci
bun run check
bun run docs:dev
```

Dependencies must be added with `bun add` from the workspace that owns them.

## License

[MIT](./LICENSE)
