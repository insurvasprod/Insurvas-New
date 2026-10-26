// AG-0.5 (Notion sprint, Agency Module 0) · the producer isolation audit — static half.
//
// Walks every /api/app route FROM THE ROUTER (the file system), never from a hand-written list, and follows
// each route's imports through lib/. A route is a HOLE when:
//   1. a role that sees only some producers (producer, assistant, setter — and manager, who rides on producer)
//      can reach it, and
//   2. some module in its import closure reads or writes producer-scoped data (a scoped table through
//      PostgREST or raw SQL, or one of the SQL functions that does), and
//   3. that module does not route through the AG-0.4 helper (scopeFor / scopeQuery / filterVisible /
//      canSeeProducerRow / visibleProducerUserIds), and neither does the route itself.
// Routes only the all-seeing roles reach (owner — and so admin —, bookkeeper, retention) are not holes: those
// roles see the whole agency by definition.
//
// The live half (scripts/agency/verify-producer-isolation.mjs) calls every route from producer A's session
// against a seeded agency and asserts zero of producer B's rows; it needs the AG migrations applied.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { SCOPED_FUNCTIONS, SCOPED_TABLES } from "./scopedData.mjs";
import { hasTenantPermission } from "../tenantAuth/permissions.ts";

export const NARROW_ROLES = ["producer", "assistant", "setter"];
const HELPER = /\b(scopeFor|scopeQuery|filterVisible|canSeeProducerRow|visibleProducerUserIds|refuseNarrowInAgency|guard(?:Attempt|Case|Lead|Requirement|IssuedPolicy|CallAttempt|Producer))\s*\(/;
const TABLE_RE = new RegExp(`(?:from\\(\\s*["'\`](${SCOPED_TABLES.join("|")})["'\`]|\\b(?:from|join|update|into)\\s+(?:public\\.)?(${SCOPED_TABLES.join("|")})\\b)`);
const FN_SET = new Set(SCOPED_FUNCTIONS);
const RPC_RE = /\.rpc(?:<[^>]*>)?\(\s*["'`]([a-z_0-9]+)["'`]/g;

function walk(dir, file = "route.ts") {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path, file);
    return name === file ? [path] : [];
  });
}

function resolveImport(root, fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = join(dirname(fromFile), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}.mjs`, join(base, "index.ts"), join(base, "index.tsx")]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

const IMPORT_RE = /(?:import|export)\s+(?:type\s+)?(?:[^'"`;]*?\s+from\s+)?["'`]([^"'`]+)["'`]/g;

export function analyse(root) {
  const cache = new Map();
  const info = (file) => {
    if (cache.has(file)) return cache.get(file);
    const text = readFileSync(file, "utf8");
    const imports = [];
    for (const m of text.matchAll(IMPORT_RE)) {
      // type-only imports carry no code
      if (/^(?:import|export)\s+type\s/.test(m[0])) continue;
      const resolved = resolveImport(root, file, m[1]);
      if (resolved && !resolved.includes("node_modules")) imports.push(resolved);
    }
    const tables = new Set();
    for (const m of text.matchAll(new RegExp(TABLE_RE, "g"))) tables.add(m[1] ?? m[2]);
    const fns = new Set();
    for (const m of text.matchAll(RPC_RE)) if (FN_SET.has(m[1])) fns.add(m[1]);
    const entry = { text, imports, touches: [...tables, ...[...fns].map((f) => `rpc:${f}`)], scopes: HELPER.test(text) };
    cache.set(file, entry);
    return entry;
  };
  // A module that routes through the helper is the scope boundary for what it imports: it filters what its
  // dependencies return (e.g. the producer scorecard filters LA-4.18's whole-book read to the visible producers),
  // so the walk does not descend past it. Everything that does NOT scope is still followed to the bottom.
  const closure = (file) => {
    const seen = new Set();
    const stack = [file];
    while (stack.length) {
      const next = stack.pop();
      if (seen.has(next)) continue;
      seen.add(next);
      if (next !== file && info(next).scopes) continue;
      for (const dep of info(next).imports) stack.push(dep);
    }
    return [...seen];
  };

  // Server pages read the same data with no API in between (AG-0.5 found the policy book, pending and
  // retention pages doing exactly that), so every page.tsx under app/app is walked too.
  const routes = walk(join(root, "app/api/app")).sort();
  const pages = walk(join(root, "app/app"), "page.tsx").sort();
  return [...routes, ...pages].map((file) => {
    const rel = relative(root, file).replace(/\\/g, "/");
    const route = info(file);
    const narrow = rel.endsWith("page.tsx") ? pageReachableByNarrowRole(route.text) : reachableByNarrowRole(route.text);
    const leaks = [];
    if (narrow && !route.scopes && !OWN_ONLY[rel]) {
      for (const mod of closure(file)) {
        const m = info(mod);
        if (m.touches.length && !m.scopes) leaks.push({ module: relative(root, mod).replace(/\\/g, "/"), touches: m.touches });
      }
    }
    return { route: rel, narrow, scoped: route.scopes, leaks };
  });
}

/**
 * Whether a producer, assistant or setter can reach a route. Resolves literal role arrays, same-file
 * `const X = [...]` lists and `rolesWith("perm")`; anything it cannot resolve counts as reachable (a guess in
 * the safe direction). A route gated with no list at all is reachable by every member.
 */
export function reachableByNarrowRole(text) {
  const calls = [...text.matchAll(/\b(requireTenant|requireFeatureRole)\s*\(([^;]*?)\)\s*;?/g)];
  if (!calls.length) return /\b(resolveTenantContext|requireFeature)\s*\(/.test(text);
  for (const [, fn, args] of calls) {
    const list = fn === "requireTenant" ? args.trim() : args.split(/,(?![^[]*\])/)[1]?.trim() ?? "";
    if (!list) return true; // requireTenant() — any member
    const literal = list.match(/^\[([^\]]*)\]/);
    if (literal) {
      if (NARROW_ROLES.some((role) => literal[1].includes(`"${role}"`))) return true;
      continue;
    }
    const name = list.match(/^([A-Za-z_][A-Za-z0-9_]*)/)?.[1];
    if (!name) return true;
    const decl = text.match(new RegExp(`\\b${name}\\b[^=\\n]*=\\s*([^;\\n]+)`));
    if (!decl) return true;
    if (/rolesWith\(/.test(decl[1])) return true; // most capabilities include producer; check the safe way
    if (NARROW_ROLES.some((role) => decl[1].includes(`"${role}"`))) return true;
    if (!/\[/.test(decl[1])) return true;
  }
  return false;
}

/**
 * Whether a producer, assistant or setter can open a server page. Pages gate by hand after guardPage(), in a
 * few shapes: `if (!actAsPage(guard, ["owner", "bookkeeper"]))` (custom team access: any role the member holds),
 * the older `if (!["owner", "bookkeeper"].includes(guard.role))` and `if (guard.role !== "owner" && …)`.
 * A page is unreachable only when it has such a gate and none of its allowed lists names a narrow role;
 * anything else (no gate, a permission check, a shape not read here) counts as reachable — the safe guess.
 *
 * Combined roles do not open a hole here: a member reaches a page whose list names no narrow role only through
 * owner, bookkeeper or retention — and holding any of those makes agency_visible_user_ids answer null (the union,
 * 20261020500000), so that member is all-seeing, not narrow (ag05.test.mjs checks the SQL says so).
 */
export function pageReachableByNarrowRole(text) {
  const lists = [];
  for (const m of text.matchAll(/!\s*\[([^\]]*)\]\s*\.includes\(\s*[\w.]*role\s*\)/g)) lists.push(m[1]);
  for (const m of text.matchAll(/!\s*\(?\s*actAsPage\(\s*\w+\s*,\s*\[([^\]]*)\]\s*\)/g)) lists.push(m[1]);
  for (const m of text.matchAll(/if\s*\(\s*((?:[\w.]*role\s*!==\s*"[a-z_]+"\s*(?:&&\s*)?)+)\)/g)) lists.push(m[1]);
  // `if (!actAsPagePermission(guard, "statements.view"))` (and the older `!hasTenantPermission(guard.role, …)`) — read
  // against the real matrix: reachable when any narrow role (or a manager) holds the permission.
  const perms = [
    ...text.matchAll(/!\s*hasTenantPermission\(\s*[\w.]*role\s*,\s*"([a-z_.]+)"\s*\)/g),
    ...text.matchAll(/!\s*actAsPagePermission\(\s*\w+\s*,\s*"([a-z_.]+)"\s*\)/g),
  ].map((m) => m[1]);
  if (!lists.length && !perms.length) return true;
  if (perms.some((perm) => [...NARROW_ROLES, "manager"].some((role) => hasTenantPermission(role, perm)))) return true;
  return lists.some((list) => NARROW_ROLES.some((role) => list.includes(`"${role}"`)));
}

/**
 * Pages whose every scoped read is ALREADY limited to the viewer's own rows (or runs only for the all-seeing
 * owner), in a way this walk cannot see. Kept short on purpose: each entry names the exact code that makes it
 * safe, and ag05.test.mjs fails the moment any proof stops being true. Prefer scoping to adding an entry.
 */
export const OWN_ONLY = {
  "app/app/(shell)/settings/page.tsx": {
    reason: "The team snapshot (the only scoped read) is fetched for the owner alone; the owner sees the whole agency.",
    proofs: [["app/app/(shell)/settings/page.tsx", "owner ? getTeamSnapshot(context.tenantId, entitlement) : null"]],
  },
  "app/app/(shell)/setters/page.tsx": {
    reason: "Owner and producer only; every appointment figure is the viewer's own calendar, the scorecard is the setters booking into it.",
    proofs: [
      ["app/app/(shell)/setters/page.tsx", 'actAsPage(guard, ["owner", "producer"])'],
      ["lib/setters/overview.ts", "const mine = appointments.filter((row) => row.agentUserId === input.userId);"],
    ],
  },
  "app/app/(shell)/book-scorecards/page.tsx": {
    reason: "Assistants and setters are refused; a producer (and a manager, who rides on producer) reads only rows where he is the agent, and no agency spend.",
    proofs: [
      ["app/app/(shell)/book-scorecards/page.tsx", 'actAsPage(guard, ["owner", "producer", "bookkeeper"])'],
      ["lib/ingestion/scorecardsStore.ts", 'const scoped = viewer.role === "producer";'],
    ],
  },
  "app/app/(shell)/retention-scorecard/page.tsx": {
    reason: "Everyone but the owner reads only the rows they attempted or worked themselves.",
    proofs: [
      ["app/app/(shell)/retention-scorecard/page.tsx", 'actAsPage(guard, ["owner", "producer", "retention"])'],
      ["lib/retention/scorecardStore.ts", 'const mineOnly = viewer.role !== "owner";'],
    ],
  },
  // The setup walkthrough (2026-10-21): tenant-wide existence checks ("has any lead been imported") are read for
  // the owner alone; anyone else gets the member list, whose only reads are their own tenant_lead_activity rows.
  "app/api/app/setup/route.ts": {
    reason: "Tenant-wide setup facts are read only for the owner; a member's facts are rows where agent_user_id is themselves.",
    proofs: [
      ["lib/dashboard/setupViewer.ts", 'const audience: SetupAudience = context.role === "owner" ? "owner" : "member";'],
      ["lib/dashboard/setupProgress.ts", '.eq("tenant_id", tenantId).eq("agent_user_id", userId)'],
    ],
  },
  "app/app/(shell)/setup/page.tsx": {
    reason: "The same loader as /api/app/setup: owner-only tenant facts, a member's own activity rows.",
    proofs: [
      ["app/app/(shell)/setup/page.tsx", "loadViewerSetup(context, available, entitlement.limits.max_seats)"],
      ["lib/dashboard/setupViewer.ts", 'const audience: SetupAudience = context.role === "owner" ? "owner" : "member";'],
    ],
  },
};
