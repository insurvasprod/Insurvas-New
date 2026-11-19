// Admin › Catalog workspace and rail badges (admin round 1, docs/design/admin-r1/catalog.html screen 1): the queues
// each Catalog page already counts, gathered into one "Needs review" list and the rail's waiting counts. Pure and
// import-free, so the workspace, GET /api/admin/catalog/steps and node:test (needs.test.mjs) share it. The reads
// live in reads.ts.
//
// Every queue is `undefined` when the role may not open its page (it is never read) and `null` when its read failed
// (the row says it couldn't be checked; the badge is left out, never sent as 0).

export type CatalogQueues = {
  status?: { words: number; rows: number; agencies: number; oldest: string | null } | null;
  reports?: { waiting: number; oldest: string | null } | null;
  fields?: { drafts: number; inReview: number; needsReview: number } | null;
  rules?: { missing: number; carriers: number } | null;
  layouts?: { noCommission: number; noPolicy: number; noneLive: number; carriers: number } | null;
  guidance?: { missing: number; carriers: number } | null;
  servicing?: { missing: number; carriers: number } | null;
  templates?: { drafts: number } | null;
  features?: { off: number; beta: number; unsold: number } | null;
};

export type CatalogNeedTone = "review" | "fill" | "unknown";

export type CatalogNeedRow = {
  key: string;
  title: string;
  detail: string;
  tone: CatalogNeedTone;
  href: string;
  /** What the row counts; 0 for a row that could not be checked. */
  count: number;
};

/**
 * Where each row opens, filtered. The pages read these parameters (Status maps, Field maps, Layout maps and the
 * carrier pages are built alongside; an unknown parameter only lands on the unfiltered page).
 */
export const CATALOG_NEED_HREF = {
  status: "/admin/status-maps",
  reports: "/admin/carrier-reports?lens=waiting",
  fields: "/admin/field-maps?status=review",
  rules: "/admin/carrier-rules?missing=1",
  noCommission: "/admin/layout-maps?tab=carriers&missing=commissions",
  noPolicy: "/admin/layout-maps?tab=carriers&missing=policies",
  unsold: "/admin/features?tab=catalog&sold=none",
  templates: "/admin/templates?status=draft",
} as const;

const n = (value: number) => value.toLocaleString("en-US");
const plural = (count: number, one: string, many = `${one}s`) => `${n(count)} ${count === 1 ? one : many}`;

/** "today", "1 day", "6 days": how long the oldest item has waited, by the request's clock. */
export function waitedWords(iso: string | null, now: number): string | null {
  if (!iso) return null;
  const ms = now - Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const days = Math.floor(ms / 86_400_000);
  return days <= 0 ? "today" : plural(days, "day");
}

/** Field maps waiting on a person: drafts, maps sent for review, and maps sent back to review after a miss. */
export function fieldsWaiting(fields: NonNullable<CatalogQueues["fields"]>): number {
  return fields.drafts + fields.inReview + fields.needsReview;
}

/**
 * The Needs review list, oldest kind of work first: the three review queues (a person must decide), then the gaps
 * to fill in. A queue with nothing in it is left out; a queue whose read failed is listed as "couldn't check".
 */
export function catalogNeeds(queues: CatalogQueues, now: number): CatalogNeedRow[] {
  const rows: CatalogNeedRow[] = [];
  const unknown = (key: string, title: string, href: string) => rows.push({ key, title, detail: "Couldn't be checked just now", tone: "unknown", href, count: 0 });

  if (queues.status === null) unknown("status", "Status words waiting", CATALOG_NEED_HREF.status);
  else if (queues.status && queues.status.words > 0) {
    const { words, rows: held, agencies } = queues.status;
    rows.push({ key: "status", title: "Status words waiting", detail: [plural(words, "word"), `${plural(held, "row")} held`, agencies > 0 ? `${plural(agencies, "agency", "agencies")} affected` : null].filter(Boolean).join(" · "), tone: "review", href: CATALOG_NEED_HREF.status, count: words });
  }

  if (queues.reports === null) unknown("reports", "Fact reports from agencies", CATALOG_NEED_HREF.reports);
  else if (queues.reports && queues.reports.waiting > 0) {
    const age = waitedWords(queues.reports.oldest, now);
    rows.push({ key: "reports", title: "Fact reports from agencies", detail: `${n(queues.reports.waiting)} waiting${age ? ` · oldest ${age}` : ""}`, tone: "review", href: CATALOG_NEED_HREF.reports, count: queues.reports.waiting });
  }

  if (queues.fields === null) unknown("fields", "Field maps in review", CATALOG_NEED_HREF.fields);
  else if (queues.fields && fieldsWaiting(queues.fields) > 0) {
    const { drafts, inReview, needsReview } = queues.fields;
    const detail = [drafts ? plural(drafts, "draft") : null, inReview ? `${n(inReview)} sent for review` : null, needsReview ? `${n(needsReview)} ${needsReview === 1 ? "needs" : "need"} review after a miss` : null].filter(Boolean).join(" · ");
    rows.push({ key: "fields", title: "Field maps in review", detail, tone: "review", href: CATALOG_NEED_HREF.fields, count: fieldsWaiting(queues.fields) });
  }

  if (queues.rules === null) unknown("rules", "Carriers missing a save rule", CATALOG_NEED_HREF.rules);
  else if (queues.rules && queues.rules.missing > 0) {
    rows.push({ key: "rules", title: "Carriers missing a save rule", detail: `${n(queues.rules.missing)} of ${n(queues.rules.carriers)}`, tone: "fill", href: CATALOG_NEED_HREF.rules, count: queues.rules.missing });
  }

  if (queues.layouts === null) unknown("layouts", "Carriers with no live layout", CATALOG_NEED_HREF.noCommission);
  else if (queues.layouts) {
    const { noCommission, noPolicy, carriers } = queues.layouts;
    if (noCommission > 0) rows.push({ key: "no-commission", title: "Carriers with no commission layout", detail: `${n(noCommission)} of ${n(carriers)}`, tone: "fill", href: CATALOG_NEED_HREF.noCommission, count: noCommission });
    if (noPolicy > 0) rows.push({ key: "no-policy", title: "Carriers with no policy layout", detail: `${n(noPolicy)} of ${n(carriers)}`, tone: "fill", href: CATALOG_NEED_HREF.noPolicy, count: noPolicy });
  }

  if (queues.features === null) unknown("unsold", "Features in no plan or add-on", CATALOG_NEED_HREF.unsold);
  else if (queues.features && queues.features.unsold > 0) {
    rows.push({ key: "unsold", title: "Features in no plan or add-on", detail: `${n(queues.features.unsold)} · nobody can buy ${queues.features.unsold === 1 ? "it" : "them"}`, tone: "fill", href: CATALOG_NEED_HREF.unsold, count: queues.features.unsold });
  }

  if (queues.templates === null) unknown("templates", "Template drafts", CATALOG_NEED_HREF.templates);
  else if (queues.templates && queues.templates.drafts > 0) {
    rows.push({ key: "templates", title: "Template drafts", detail: `${n(queues.templates.drafts)} not published`, tone: "fill", href: CATALOG_NEED_HREF.templates, count: queues.templates.drafts });
  }

  return rows;
}

/** Things that wait for a person's review: status words, fact reports and field maps. The workspace's badge. */
export function reviewWaiting(queues: CatalogQueues): { total: number; queues: number } | null {
  const parts = [queues.status, queues.reports, queues.fields];
  if (parts.every((part) => part === undefined)) return { total: 0, queues: 0 };
  if (parts.some((part) => part === null)) return null;
  const counts = [queues.status?.words ?? 0, queues.reports?.waiting ?? 0, queues.fields ? fieldsWaiting(queues.fields) : 0];
  return { total: counts.reduce((sum, value) => sum + value, 0), queues: counts.filter((value) => value > 0).length };
}

/**
 * The rail's badges (GET /api/admin/catalog/steps), for the steps the role may open. A count whose read failed is
 * left out, never sent as 0 (lib/adminCatalog/steps.ts CATALOG_WAITING names what each counts).
 */
export function catalogStepCounts(queues: CatalogQueues, steps: ReadonlySet<string>): Record<string, number> {
  const counts: Record<string, number> = {};
  const put = (step: string, value: number | null | undefined) => {
    if (steps.has(step) && typeof value === "number") counts[step] = value;
  };
  const review = reviewWaiting(queues);
  put("workspace", review ? review.total : null);
  put("features", queues.features ? queues.features.off : null);
  put("templates", queues.templates ? queues.templates.drafts : null);
  put("rules", queues.rules ? queues.rules.missing : null);
  put("layouts", queues.layouts ? queues.layouts.noneLive : null);
  put("status", queues.status ? queues.status.words : null);
  put("fields", queues.fields ? fieldsWaiting(queues.fields) : null);
  put("guidance", queues.guidance ? queues.guidance.missing : null);
  put("servicing", queues.servicing ? queues.servicing.missing : null);
  put("reports", queues.reports ? queues.reports.waiting : null);
  return counts;
}

/** Which carriers lack a live (published) layout of each kind. Assignments point at a layout key; live means a
 *  published version of that key exists. */
export function layoutGaps(input: {
  carriers: ReadonlyArray<{ id: string }>;
  assignments: ReadonlyArray<{ carrierId: string; fileType: string; layoutKey: string }>;
  maps: ReadonlyArray<{ layoutKey: string; status: string }>;
}): { noCommission: number; noPolicy: number; noneLive: number; carriers: number } {
  const live = new Set(input.maps.filter((map) => map.status === "published").map((map) => map.layoutKey));
  const has = (carrierId: string, fileType: string | null) =>
    input.assignments.some((row) => row.carrierId === carrierId && (fileType === null || row.fileType === fileType) && live.has(row.layoutKey));
  let noCommission = 0;
  let noPolicy = 0;
  let noneLive = 0;
  for (const carrier of input.carriers) {
    if (!has(carrier.id, "commissions")) noCommission += 1;
    if (!has(carrier.id, "policies")) noPolicy += 1;
    if (!has(carrier.id, null)) noneLive += 1;
  }
  return { noCommission, noPolicy, noneLive, carriers: input.carriers.length };
}
