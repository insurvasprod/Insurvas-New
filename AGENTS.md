<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

<!-- BEGIN:design-rules -->

# Design rules: read before building or changing any screen

- **The authority:** [`docs/design/UI-CONSISTENCY.md`](docs/design/UI-CONSISTENCY.md). §0 lists the
  v3 foundation rules and whether each is live yet. Colour, type and logo:
  [`docs/design/BRAND.md`](docs/design/BRAND.md).
- **The look:** [`docs/design/foundation-v3/mockup.html`](docs/design/foundation-v3/mockup.html)
  (open in a browser).
- **Where to start:** every component and route folder has a `README.md` naming the shared
  components to use and the rules that apply there, for example
  [`components/ui/README.md`](components/ui/README.md).
- **Compose, do not hand-roll:** pages are built from `components/ui`. If something is missing,
  extend the shared component once, for everyone.
- **Enforced:** `lib/design/uiConsistency.test.mjs`, `lib/design/brandContrast.test.mjs` and
  `lib/design/designDocs.test.mjs` run under `npm test`.

<!-- END:design-rules -->
