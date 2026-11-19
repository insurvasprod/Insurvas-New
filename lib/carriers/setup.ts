// A carrier's set-up at a glance (admin round 1, Catalog › Carriers and the carrier record; board
// docs/design/admin-r1/catalog.html screens 7–8): the eight things that make a carrier work for an agency,
// each set up, partly set up or waiting for review, or missing. Plain module: no server imports, so the
// Carriers table, the record page and the tests share one reading of the same counts.

export const FACETS = ["facts", "rules", "layouts", "status", "fields", "guide", "servicing", "reports"] as const;
export type FacetKey = (typeof FACETS)[number];

/** set ● · waiting ◐ (partly set up, or something waits for a review) · missing ○ · unknown: the read failed. */
export type FacetState = "set" | "waiting" | "missing" | "unknown";
export type FacetCell = { state: FacetState; detail: string; count?: number };
export type CarrierSetup = Record<FacetKey, FacetCell>;

/** The carrier record's tabs, in order. Each facet opens one of them. */
export const RECORD_TABS = ["overview", "rules", "files", "status", "fields", "guide", "servicing", "reports", "history"] as const;
export type RecordTab = (typeof RECORD_TABS)[number];

export const RECORD_TAB_LABEL: Record<RecordTab, string> = {
  overview: "Overview",
  rules: "Rules",
  files: "Files & layouts",
  status: "Status words",
  fields: "Field maps",
  guide: "Portal guide",
  servicing: "Servicing",
  reports: "Fact reports",
  history: "History",
};

export const FACET_INFO: Record<FacetKey, { label: string; tab: RecordTab; missing: string }> = {
  facts: { label: "Portal & references", tab: "overview", missing: "No portal address, policy number pattern or bank descriptor" },
  rules: { label: "Rules", tab: "rules", missing: "Missing a save rule" },
  layouts: { label: "Layouts", tab: "files", missing: "No live file layout" },
  status: { label: "Status words", tab: "status", missing: "Status words waiting or none mapped" },
  fields: { label: "Field maps", tab: "fields", missing: "No published field map" },
  guide: { label: "Portal guide", tab: "guide", missing: "No portal guidance" },
  servicing: { label: "Servicing", tab: "servicing", missing: "Servicing instructions missing" },
  reports: { label: "Reports", tab: "reports", missing: "A fact report waits" },
};

export const FACET_STATE_LABEL: Record<FacetState, string> = {
  set: "Set up",
  waiting: "Partly set up or waiting for review",
  missing: "Missing",
  unknown: "Could not be read",
};

const FILE_LABEL: Record<string, string> = { policies: "Policies", commissions: "Commissions", new_business: "New business" };
export const RULE_TYPE_COUNT = 5;
export const SERVICING_TYPE_COUNT = 4;

/** What the server read for every carrier; a null facet is one whose read failed (shown as unknown, never missing). */
export type SetupInputs = {
  facts: Map<string, { portalOrigin: string | null; referencePattern: string | null; billingDescriptor: string | null }> | null;
  /** Per carrier: rule types with a window set, and how many of those are unverified. */
  rules: Map<string, { set: number; unverified: number }> | null;
  /** Per carrier: the file types it is assigned a layout for, and which of those have a live (published) version. */
  layouts: Map<string, { assigned: { fileType: string; layoutKey: string; liveVersion: number | null }[] }> | null;
  status: Map<string, { approved: number; waiting: number; rowsHeld: number }> | null;
  fields: Map<string, { published: number; open: number }> | null;
  guide: Set<string> | null;
  servicing: Map<string, number> | null;
  reports: Map<string, number> | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
const unknown: FacetCell = { state: "unknown", detail: "Could not be read" };

export function carrierSetup(carrierId: string, inputs: SetupInputs): CarrierSetup {
  return {
    facts: factsCell(inputs.facts?.get(carrierId), inputs.facts !== null),
    rules: inputs.rules ? rulesCell(inputs.rules.get(carrierId)) : unknown,
    layouts: inputs.layouts ? layoutsCell(inputs.layouts.get(carrierId)) : unknown,
    status: inputs.status ? statusCell(inputs.status.get(carrierId)) : unknown,
    fields: inputs.fields ? fieldsCell(inputs.fields.get(carrierId)) : unknown,
    guide: inputs.guide ? (inputs.guide.has(carrierId) ? { state: "set", detail: "Written" } : { state: "missing", detail: "Not written yet" }) : unknown,
    servicing: inputs.servicing ? servicingCell(inputs.servicing.get(carrierId) ?? 0) : unknown,
    reports: inputs.reports ? reportsCell(inputs.reports.get(carrierId) ?? 0) : unknown,
  };
}

function factsCell(facts: { portalOrigin: string | null; referencePattern: string | null; billingDescriptor: string | null } | undefined, read: boolean): FacetCell {
  if (!read) return unknown;
  const set = facts ? [facts.portalOrigin, facts.referencePattern, facts.billingDescriptor].filter((v) => Boolean(v && v.trim())).length : 0;
  if (set === 3) return { state: "set", detail: "Portal, policy number and bank descriptor set" };
  if (set === 0) return { state: "missing", detail: "None of the three set" };
  return { state: "waiting", detail: `${set} of 3 set` };
}

function rulesCell(rules: { set: number; unverified: number } | undefined): FacetCell {
  const set = rules?.set ?? 0;
  const unverified = rules?.unverified ?? 0;
  if (set === 0) return { state: "missing", detail: `0 of ${RULE_TYPE_COUNT}` };
  const verified = set - unverified;
  const detail = `${set} of ${RULE_TYPE_COUNT} · ${verified.toLocaleString("en-US")} verified`;
  return { state: set >= RULE_TYPE_COUNT && unverified === 0 ? "set" : "waiting", detail };
}

function layoutsCell(layouts: { assigned: { fileType: string; layoutKey: string; liveVersion: number | null }[] } | undefined): FacetCell {
  const assigned = layouts?.assigned ?? [];
  if (!assigned.length) return { state: "missing", detail: "No layout assigned" };
  const live = assigned.filter((a) => a.liveVersion !== null);
  const detail = assigned.map((a) => `${FILE_LABEL[a.fileType] ?? a.fileType} ${a.liveVersion !== null ? `v${a.liveVersion}` : "draft only"}`).join(" · ");
  return { state: live.length ? (live.length === assigned.length ? "set" : "waiting") : "waiting", detail };
}

function statusCell(status: { approved: number; waiting: number; rowsHeld: number } | undefined): FacetCell {
  const approved = status?.approved ?? 0;
  const waiting = status?.waiting ?? 0;
  if (waiting > 0) return { state: "waiting", detail: `${waiting.toLocaleString("en-US")} waiting · ${plural(status?.rowsHeld ?? 0, "row")} held`, count: waiting };
  if (approved > 0) return { state: "set", detail: `${plural(approved, "word")} mapped` };
  return { state: "missing", detail: "No words mapped yet" };
}

function fieldsCell(fields: { published: number; open: number } | undefined): FacetCell {
  const published = fields?.published ?? 0;
  const open = fields?.open ?? 0;
  if (published > 0) return { state: open > 0 ? "waiting" : "set", detail: `${published.toLocaleString("en-US")} published${open ? ` · ${open.toLocaleString("en-US")} to review` : ""}` };
  if (open > 0) return { state: "waiting", detail: `${open.toLocaleString("en-US")} to review, none published` };
  return { state: "missing", detail: "No field map" };
}

function servicingCell(written: number): FacetCell {
  if (written >= SERVICING_TYPE_COUNT) return { state: "set", detail: `${SERVICING_TYPE_COUNT} of ${SERVICING_TYPE_COUNT}` };
  return { state: written === 0 ? "missing" : "waiting", detail: `${written} of ${SERVICING_TYPE_COUNT}` };
}

function reportsCell(open: number): FacetCell {
  return open > 0 ? { state: "waiting", detail: `${plural(open, "report")} waiting`, count: open } : { state: "set", detail: "None waiting" };
}

/** The Carriers table's "Missing" filter: the facet is missing or waits on someone (an unknown read never matches). */
export function needsLook(cell: FacetCell): boolean {
  return cell.state === "missing" || cell.state === "waiting";
}

/** How many of the eight are fully set up (the record's status line). */
export function setUpCount(setup: CarrierSetup): number {
  return FACETS.filter((key) => setup[key].state === "set").length;
}

/** The carrier record's address, on a tab. */
export function carrierHref(code: string, tab?: RecordTab): string {
  return `/admin/carriers/${encodeURIComponent(code)}${tab && tab !== "overview" ? `?tab=${tab}` : ""}`;
}

export function isFacet(value: string | null | undefined): value is FacetKey {
  return Boolean(value && (FACETS as readonly string[]).includes(value));
}

export function isRecordTab(value: string | null | undefined): value is RecordTab {
  return Boolean(value && (RECORD_TABS as readonly string[]).includes(value));
}
