// Settings › AI assistant, round 8 (board settings-r8/products-and-ai, option A "What it will do", owner pick
// 2026-11-12): the words the page shows. The two data lists are today's facts (LA-3.3), fixed in code: the
// interview payload is what would be sent, SENSITIVE_FIELD_KEYS what never is. Nothing here calls a provider.

import type { SalesSettings } from "@/lib/salesSettings/schema";

export type EarlyList = NonNullable<SalesSettings["aiEarlyList"]>;
export type FeatureKey = EarlyList["features"][number];

export const FEATURES: ReadonlyArray<{ key: FeatureKey; mark: string; title: string; first?: boolean; body: string; example: string; where: string }> = [
  {
    key: "underwriting", mark: "U", title: "Underwriting helper", first: true,
    body: "Reads the health answers and medications on the Interview step and says which carriers will likely take the client, and why.",
    example: "“Metformin since 2019, A1C not asked: Mutual of Omaha Level likely; AmAm graded.”",
    where: "Interview step · reads answers and medications",
  },
  {
    key: "summaries", mark: "S", title: "Call summaries",
    body: "After each call, a short summary on the lead: what was asked, what was agreed, the next step. The agent edits it before it's saved.",
    example: "“Wants $15k burial cover. Spouse on next call Thu 2 PM.”",
    where: "Lead page · after each call",
  },
  {
    key: "next_step", mark: "N", title: "Next best step",
    body: "Suggests the one next thing for a lead: call back now, send the quote, ask for the bank draft date.",
    example: "“Quote sent 2 days ago, not opened. Call before 6 PM her time.”",
    where: "Lead page and dialer",
  },
  {
    key: "quote_explainer", mark: "Q", title: "Quote explainer",
    body: "Turns a quote into two plain sentences the agent can read to the client: price, cover, waiting period.",
    example: "“$48.20 a month for $15,000. Full cover from day one.”",
    where: "Quote step",
  },
  {
    key: "compliance", mark: "C", title: "Compliance check",
    body: "Before Submit, checks the required disclosures were read and the recording consent was given, and names any gap.",
    example: "“Replacement disclosure not read. Read it before submitting.”",
    where: "Finish step · before Submit",
  },
];

/** What the interview payload carries (today's list, unchanged). */
export const SENT = [
  { label: "The question text", sub: "As the underwriting template words it" },
  { label: "The answer text", sub: "As the agent recorded it" },
  { label: "Medication names and doses", sub: "Name, dose, since when and what it is for" },
  { label: "The product", sub: "The product line being quoted" },
  { label: "The state", sub: "The client's state, for state rules" },
];

// Income (LA-5.10) is kept on the client record, never in the interview answers, so no answer payload can carry it.
export const NEVER = ["Name", "Social Security number", "Bank routing and account numbers", "Card numbers", "Home address", "Phone number", "Email address", "Date of birth", "Income", "Screenshots of any kind"];

export const DEFAULT_CONTROLS: EarlyList["controls"] = { sendDoses: true, keepFor: "1_year", who: "everyone" };

/** A fresh entry: the board's three picks, "just email me", default controls. */
export function blankEarlyList(): EarlyList {
  return { joined: false, joinedAt: null, joinedBy: null, features: ["underwriting", "summaries", "compliance"], whenReady: "email", controls: DEFAULT_CONTROLS };
}

export const KEEP_FOR: ReadonlyArray<{ key: EarlyList["controls"]["keepFor"]; label: string }> = [
  { key: "30_days", label: "30 days" },
  { key: "1_year", label: "1 year" },
  { key: "like_the_lead", label: "Like the lead" },
];

export const WHO: ReadonlyArray<{ key: EarlyList["controls"]["who"]; label: string }> = [
  { key: "admins", label: "Admins" },
  { key: "everyone", label: "Everyone" },
];

export const WHEN_READY: ReadonlyArray<{ key: EarlyList["whenReady"]; label: string; title: string; sub: string }> = [
  { key: "email", label: "Email me", title: "Just email me", sub: "It stays off until you switch it on" },
  { key: "admins", label: "Turn it on for admins to try", title: "Turn it on for admins to try", sub: "Agents don't see it until you say so" },
];
