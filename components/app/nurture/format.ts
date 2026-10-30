import type { NurtureCampaignReport, NurtureReport } from "@/lib/nurture/report";
import { RECYCLABLE_DISPOSITIONS, SAID_NO_MIN_DAYS, STALLED_MINUTES, type RecycleBatch } from "@/lib/nurture/contract";
import { isOwnBookVendor } from "@/lib/campaigns/ownBook";

/** Shared by the Recycle step's parts (components/app/nurture-workspace.tsx and components/app/nurture/*). */
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const label = (value: string) => value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
export const count = (value: number) => value.toLocaleString("en-US");
export const plural = (value: number, one: string, many = `${one}s`) => `${count(value)} ${value === 1 ? one : many}`;
export const percent = (value: number | null) => (value == null ? "—" : `${value.toFixed(1)}%`);

export function stamp(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** Who may continue a running batch: its starter, or an owner once it has stalled (the SQL's rule). */
export function canContinue(batch: RecycleBatch, viewer: NurtureReport["viewer"]) {
  if (batch.createdBy === viewer.userId) return { ok: true, reason: "" };
  if (viewer.role !== "owner") return { ok: false, reason: `Only ${batch.createdByName ?? "the person who started it"} or an owner can continue this batch.` };
  if (!batch.stalled) return { ok: false, reason: `${batch.createdByName ?? "Someone"} is screening it now. An owner can resume it after ${STALLED_MINUTES} minutes without progress.` };
  return { ok: true, reason: "" };
}

export const money = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

/** The Rule panel's draft: the steppers hold text while typed, so the numbers stay strings until saved. */
export type RuleDraft = { wait: string; max: string; outcomes: string[] };
type Rule = NurtureCampaignReport["rule"];

export const draftOf = (rule: Rule): RuleDraft => ({ wait: String(rule.wait_days), max: String(rule.max_recycles), outcomes: [...rule.allowed_dispositions] });

export function sameRule(draft: RuleDraft, rule: Rule) {
  const saved = new Set(rule.allowed_dispositions);
  return draft.wait === String(rule.wait_days) && draft.max === String(rule.max_recycles)
    && draft.outcomes.length === saved.size && draft.outcomes.every((item) => saved.has(item));
}

/** What stops the draft being saved (the route's own checks, normalizeRecycleRule), or "". */
export function draftProblem(draft: RuleDraft) {
  const wait = Number(draft.wait);
  const max = Number(draft.max);
  if (draft.wait.trim() === "" || !Number.isInteger(wait) || wait < 1 || wait > 3650) return "Rest between 1 and 3,650 days";
  if (draft.max.trim() === "" || !Number.isInteger(max) || max < 0 || max > 100) return "Recycle at most 0 to 100 times";
  if (!draft.outcomes.length) return "Pick at least one outcome to recycle";
  return "";
}

/** What a campaign with no saved rule recycles by (tenant_nurture_campaigns' coalesce, 20260913450000). */
export const DEFAULT_RULE: Rule = { wait_days: 180, allowed_dispositions: ["no_answer", "voicemail"], max_recycles: 3 };
export const isDefaultRule = (rule: Rule) => sameRule(draftOf(DEFAULT_RULE), rule);

/** Days after the outcome before a lead with it comes back (said no: the rule's wait, at least 90; the SQL's greatest()). */
export const restDays = (rule: Rule, outcome: string) => (outcome === "not_interested" ? Math.max(rule.wait_days, SAID_NO_MIN_DAYS) : rule.wait_days);

/** The table's Rule cell: "30 / 30 / 90 days · max 3", "60 days · max 2", or "Default". */
export function ruleSummary(rule: Rule) {
  if (isDefaultRule(rule)) return "Default";
  if (rule.max_recycles === 0) return "Off · max 0";
  const days = RECYCLABLE_DISPOSITIONS.filter((outcome) => rule.allowed_dispositions.includes(outcome)).map((outcome) => restDays(rule, outcome));
  const shown = days.every((day) => day === days[0]) ? [days[0]] : days;
  return `${shown.map(count).join(" / ")} days · max ${rule.max_recycles}`;
}

/** The line under a campaign's name: "3 lists", "No vendor" (the own-book stand-in), or the vendor. */
export function sourceLine(campaign: NurtureCampaignReport) {
  if (campaign.vendorName != null && isOwnBookVendor(campaign.vendorName)) return "No vendor";
  if (campaign.lists != null) return plural(campaign.lists, "list");
  return campaign.vendorName ?? "";
}

/** Why a campaign can't start a batch now, or "" when it can. */
export function startBlockedFor(campaign: NurtureCampaignReport, batchesReady: boolean) {
  return !batchesReady ? "Batches need a database update that has not been applied yet."
    : campaign.openBatch ? "This campaign already has a batch being screened."
    : campaign.rule.max_recycles === 0 ? "The recycle cap is 0."
    : campaign.eligibleNow === 0 ? "Nothing in this campaign meets the rule yet."
    : "";
}
