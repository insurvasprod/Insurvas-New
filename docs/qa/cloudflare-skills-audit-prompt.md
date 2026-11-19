# Cloudflare skills audit — prompt

Paste everything below the line into a new Claude Code session in this repo.
The Cloudflare skills are installed at `.claude/skills/` (22 skills, from
`github.com/cloudflare/skills`, installed 2026-11-13).

---

Run a read-only health audit of Insurvas using the installed Cloudflare skills. Find
problems, prove each one, rank them. Do not fix anything until I approve the list.

## What this app actually runs on (check before you load a skill)

- Next.js 16.3 (App Router, `proxy.ts`), React 19, deployed on **Vercel** (fra1).
  `www.insurvas.com` and `app.insurvas.com` answer with `Server: Vercel`, no `cf-ray`.
- Data and auth: **Supabase** (Postgres + RLS, multi-tenant). There is no Wrangler config,
  no Workers, no D1/KV/R2, and no Cloudflare in front of the domains today.
- So most Cloudflare skills do not apply. Use only these four, in this order:

| Skill | Use it for | Scope |
|---|---|---|
| `web-perf` | Core Web Vitals, network chains, caching, bundle weight, accessibility snapshot, codebase phase | Main pass |
| `workers-best-practices` | Its runtime rules that are not Workers-specific (no request state in module globals, every promise awaited or handed to `after()`, streaming large bodies, secrets never in code or logs, structured errors, observability) applied to `app/api/**` route handlers and `lib/**` server code | Review checklist only. Ignore wrangler, bindings, compatibility-date and Durable Object rules |
| `turnstile-spin` | Assess whether public, unauthenticated entry points need bot verification | **Assessment only.** Do not run its scripts, create a widget or ask for a Cloudflare token |
| `cloudflare` | One short note: would WAF / rate limiting / bot management in front of Vercel close a gap you found? | Recommendation only, no account changes |

Do not load `wrangler`, `cf-cli`, `durable-objects`, `agents-sdk`, `sandbox-*`, `cloudflare-one*`,
`basin`, `k2`, `gateway-workers`, `cloudflare-app-bootstrap`, `cloudflare-email-service`,
`workers-development`, `workers-profiling` or `frameworks-on-cloudflare`. Load
`nextjs-on-cloudflare` only if I later ask whether to move off Vercel.

## House rules (from CLAUDE.md, AGENTS.md and memory — follow them)

- Codebase questions: run `graphify query "<question>"` before any grep or file read; use
  `graphify path` / `graphify explain` for relationships. Read raw files only for lines the
  graph already located. Put this rule in every subagent prompt.
- Next.js here has breaking changes: check `node_modules/next/dist/docs/` before judging an API.
- Run node tools from PowerShell, not Bash.
- Production and the demo tenants are live. Read only: no form submits, no "Resolved"/"Send"
  clicks, never click by a fallback selector, no SQL writes, no migrations.
- UI findings are judged against `docs/design/UI-CONSISTENCY.md` and `docs/design/BRAND.md`,
  not general taste.

## Pass 1 — Performance (`web-perf`)

1. Check whether a Chrome DevTools MCP server is connected. If not, stop and ask me whether to
   add `chrome-devtools-mcp`. If I say no, fall back to the built-in browser: network requests
   plus `PerformanceObserver` readings for LCP, CLS, INP and long tasks via `javascript_tool`,
   and say which trace insights you could not collect.
2. Measure a **production build** (`next build && next start`), not `next dev` — dev numbers
   are meaningless here (router prefetch is also off in dev). Also measure the live
   `https://www.insurvas.com` marketing pages, which need no sign-in.
3. Pages, cold load then warm navigation for each:
   - public: `/`, `/signup`, `/app/login`, `/partner/login`
   - signed in (use the browser-pass setup from memory): `/app/dashboard`, `/app/agency`,
     `/app/leads`, one `/app/leads/[id]`, the dialer, Reports, Commissions, Settings
4. For each page report TTFB, FCP, LCP, CLS, INP/TBT, JS transferred, request count,
   and the slowest server call. Flag only items with a measurable cost.
5. Codebase phase: oversized client bundles, `"use client"` set too high in the tree, wholesale
   imports of large libraries, images without dimensions, fonts that shift layout, missing
   `Cache-Control` on API routes that could cache, and Supabase calls made in a waterfall that
   could run in parallel.

## Pass 2 — Server code review (`workers-best-practices`, transferable rules only)

Sweep `app/api/**`, `proxy.ts`, `lib/**` (server-only files). Flag:
- module-level mutable state that can leak between requests or tenants
- floating promises (not awaited, not in `after()`), swallowed errors, `catch {}` with no log
- full request/response bodies buffered in memory where streaming is needed (CSV import,
  carrier files, exports)
- secrets or tokens in source, logs, error messages or client bundles (`NEXT_PUBLIC_*` that
  should not be public)
- service-role Supabase clients used without an explicit tenant filter
- cron routes (`app/api/cron/**`) and webhooks without signature or secret checks

## Pass 3 — Abuse surface (`turnstile-spin` assessment)

List every public, unauthenticated write: `app/api/public/signup`, `app/api/public/contact`,
`app/api/app/signup`, `app/api/leads/post`, `app/api/post`, `app/api/webhooks/**`,
`app/api/v1/**`, the three login pages and any password-reset flow. For each, say what
protects it today (`lib/rateLimit`, `lib/authProtection` lockout, API keys, signatures) and
whether bot verification would add real protection. Login already has rate limiting and
lockout — do not recommend Turnstile there unless you find a concrete gap. Then, with the
`cloudflare` skill, say in one paragraph whether a Cloudflare layer in front of Vercel is worth
it for what you found, or whether Vercel's own firewall covers it.

## Output

One report at `docs/qa/cloudflare-audit-<date>.md`:

1. **Core Web Vitals table** — page × metric, rated good / needs improvement / poor.
2. **Findings**, most severe first. Each: severity, `file:line` or URL, the evidence
   (measurement, request, or code excerpt), the user impact, and the proposed fix in one or
   two sentences. Only findings you verified — mark anything unproven as "suspected".
3. **What is already fine** — say so plainly where a page or route is healthy.
4. **Not covered** — anything you could not measure and why.

Then stop and ask which findings to fix.
