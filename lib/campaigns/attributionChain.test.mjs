// Run with: npm test
//
// LA-2.1 acceptance criterion 1: "Every lead carries its `campaign_id`, and it survives into the
// application and the policy record."
//
// The ticket states the stake rather than leaving it implied:
//
//   "`campaign_id` travels with the lead forever — onto the application, onto the policy. One column
//    at each hop. Without it, cost per issued policy (LA-2.17) cannot be computed at all, and that is
//    the number that decides which vendor Ray buys from next month."
//
// ## Where the chain actually reaches, measured 2026-09-22
//
//   agent_leads.campaign_id   column present, written by lib/leadPost/service.ts
//   deal_flow.campaign_id     column present, **written by nothing**   0 of 19 rows populated
//   applications / policies   the tables do not exist yet
//
// So the first hop holds and the second is a column with no writer. That is not yet a bug: the two
// callers of `writePartnerIntakeArtifacts` — a partner submission and an affiliate referral — carry a
// `partner_id`, not a campaign, so they would only ever write null. The path that does have a
// campaign (`leadPost`) writes no deal-flow row at all, and which module should close that belongs to
// LA-2.5/2.9 rather than here.
//
// ## What this guards
//
// The failure mode is silent and expensive: LA-2.17 computes cost per issued policy by reading this
// chain. A reporting query that groups by `deal_flow.campaign_id` while nothing populates it does not
// error — it returns a tidy, confident table in which every campaign has zero attributed deals, which
// is exactly the kind of plausible wrongness this audit keeps finding.
//
// So: the day something READS that column for attribution, something must WRITE it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, sep } from "node:path";

const ROOT = process.cwd();

function sourceFiles(target) {
  const absolute = join(ROOT, target);
  if (!existsSync(absolute)) return [];
  if (statSync(absolute).isFile()) return [target];
  const found = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (["node_modules", ".next"].includes(entry.name)) continue;
    const child = `${target}/${entry.name}`;
    if (entry.isDirectory()) found.push(...sourceFiles(child));
    else if ([".ts", ".tsx"].includes(extname(entry.name))) found.push(child);
  }
  return found;
}

const sources = () =>
  ["lib", "app"]
    .flatMap(sourceFiles)
    .filter((path) => path !== "lib/supabase/database.types.ts")
    .map((path) => [path.split(sep).join("/"), readFileSync(join(ROOT, path), "utf8")]);

/** A `from("deal_flow")` chain that mentions campaign_id within the same statement. */
const DEAL_FLOW_CAMPAIGN = /from\(\s*['"`]deal_flow['"`]\s*\)[\s\S]{0,400}?campaign_id/;
const DEAL_FLOW_CAMPAIGN_WRITE = /from\(\s*['"`]deal_flow['"`]\s*\)[\s\S]{0,400}?\.(insert|upsert|update)\s*\([\s\S]{0,400}?campaign_id/;

test("nothing reads deal_flow.campaign_id for attribution while nothing writes it", () => {
  const readers = [];
  const writers = [];
  for (const [path, source] of sources()) {
    if (DEAL_FLOW_CAMPAIGN_WRITE.test(source)) writers.push(path);
    else if (DEAL_FLOW_CAMPAIGN.test(source)) readers.push(path);
  }

  if (writers.length > 0) return; // the chain is closed; reading it is then correct

  assert.deepEqual(
    readers,
    [],
    `deal_flow.campaign_id is read for attribution but never written, so every campaign will show ` +
      `zero attributed deals rather than an error:\n  ${readers.join("\n  ")}\n` +
      `Close the chain where the campaign is known (lib/leadPost/service.ts) before reporting on it.`,
  );
});

test("the lead still carries its campaign at the first hop", () => {
  // The hop that does work. If this stops, nothing downstream can be attributed at all.
  const leadPost = readFileSync(join(ROOT, "lib", "leadPost", "service.ts"), "utf8");
  assert.match(
    leadPost,
    /from\(\s*["'`]agent_leads["'`]\s*\)[\s\S]{0,600}?campaign_id:/,
    "the lead-post path no longer writes campaign_id onto the lead — LA-2.17 has nothing to group by",
  );
});

test("effective cost per record is derived by the database, not maintained by hand", () => {
  // LA-2.1 criterion 2: "Effective cost per record changes when a credit is recorded, and the change
  // is visible." It is a generated column — (spend - credits) / records_purchased — so recording a
  // credit changes it with no code path to forget. Pinned because turning it into a stored column
  // that someone updates is the obvious "optimisation" and would reintroduce exactly the drift the
  // criterion forbids.
  const migrations = join(ROOT, "supabase", "migrations");
  if (!existsSync(migrations)) return;

  const generated = readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(join(migrations, file), "utf8"))
    .some((sql) => /effective_cost_per_record_cents\s+numeric\s+generated\s+always\s+as/i.test(sql));

  assert.ok(
    generated,
    "effective_cost_per_record_cents is no longer a generated column; a credit would stop changing it",
  );
});
