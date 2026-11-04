/**
 * The public roadmap (2026-11-04, owner): what has shipped, what is being built, what is planned and
 * what is only being explored. Quarters, never dates.
 *
 * DRAFT CONTENT. The owner asked for "some content for now"; these items are drawn from the product
 * and the "Insurvas OS Landing" copy, not from a confirmed plan. Confirm each item and its status
 * before the page is promoted. Edit this file and nothing else to change the page or the landing teaser.
 */
export type RoadmapStatus = "shipped" | "progress" | "planned" | "exploring";

export type RoadmapItem = {
  id: string;
  status: RoadmapStatus;
  /** A quarter, or "Later" for exploring. */
  when: string;
  title: string;
  text: string;
  /** The leak it closes; matches the tabs in "What's broken today". */
  theme: "Retention" | "Draft dates" | "Statements" | "Vendors" | "Compliance" | "Profit" | "Team";
};

export const ROADMAP_STATUS: Record<RoadmapStatus, { label: string; blurb: string }> = {
  shipped: { label: "Shipped", blurb: "In your workspace now." },
  progress: { label: "In progress", blurb: "Being built this quarter." },
  planned: { label: "Planned", blurb: "Next in line. Scope can still change." },
  exploring: { label: "Exploring", blurb: "Not committed. Tell us if you need it." },
};

export const ROADMAP: RoadmapItem[] = [
  { id: "cost-per-lead", status: "shipped", when: "Q4 2026", title: "Lead cost on every lead", text: "Cost recorded from every list and every transfer, so true CPA is computed from your own linked data.", theme: "Vendors" },
  { id: "dial-screening", status: "shipped", when: "Q4 2026", title: "Screening before every dial", text: "Consent, DNC, your suppression list and the calling window are re-checked on the server before a call is placed.", theme: "Compliance" },
  { id: "statement-matching", status: "shipped", when: "Q4 2026", title: "Statement upload and line matching", text: "Each statement line is matched to a policy in your book, and you accept every match.", theme: "Statements" },
  { id: "save-queue", status: "progress", when: "Q4 2026", title: "Save queue and payment repair", text: "At-risk policies ranked by risk times money, with failed drafts and lapse notices flagged before the draft date.", theme: "Retention" },
  { id: "draft-date", status: "progress", when: "Q4 2026", title: "Draft-date check on the application", text: "The Social Security deposit window is worked out from the date of birth, and an early draft date is flagged before you submit.", theme: "Draft dates" },
  { id: "vendor-scorecard", status: "planned", when: "Q1 2027", title: "Vendor scorecard with lapses included", text: "True cost per sale that stays, beside the sticker price, for every lead source.", theme: "Vendors" },
  { id: "dispute-letters", status: "planned", when: "Q1 2027", title: "Dispute letters from the discrepancy report", text: "Missing, short-paid and duplicate lines drafted with the policy numbers and the arithmetic.", theme: "Statements" },
  { id: "team-roles", status: "planned", when: "Q1 2027", title: "Roles for owner, producer, assistant and bookkeeper", text: "Everyone sees what their job needs. Assistants see no money data at all.", theme: "Team" },
  { id: "payout-statements", status: "planned", when: "Q2 2027", title: "Producer payout statements", text: "Splits, overrides and payouts worked out per producer, per month.", theme: "Profit" },
  { id: "litigation-packet", status: "planned", when: "Q2 2027", title: "One-click litigation packet", text: "Every call, recording, consent certificate and scrub result for one contact, in one export.", theme: "Compliance" },
  { id: "carrier-eapp", status: "exploring", when: "Later", title: "Carrier e-application", text: "Submit from the application screen instead of re-keying into the carrier’s portal.", theme: "Draft dates" },
  { id: "mobile-save-queue", status: "exploring", when: "Later", title: "Save queue on a phone", text: "Work at-risk policies and call customers from your phone.", theme: "Retention" },
];

/** The groups in page order: a status and quarter that share one block on the timeline. */
export function roadmapGroups() {
  const order: RoadmapStatus[] = ["shipped", "progress", "planned", "exploring"];
  const groups: { key: string; status: RoadmapStatus; when: string; items: RoadmapItem[] }[] = [];
  for (const status of order) {
    for (const item of ROADMAP.filter((entry) => entry.status === status)) {
      const key = `${status}-${item.when}`;
      const existing = groups.find((group) => group.key === key);
      if (existing) existing.items.push(item);
      else groups.push({ key, status, when: item.when, items: [item] });
    }
  }
  return groups;
}
