// Matches the Insurvas CRM's dominant grid convention (navy header, uppercase small bold
// labels, white text) so the two apps read as one product family.
export const tableHeaderRow = "border-0 bg-[var(--brand-700)] hover:bg-[var(--brand-700)]";
export const tableHeadCell = "text-[11px] font-black uppercase tracking-wide text-white whitespace-nowrap";
// overflow-x-auto, not overflow-hidden: a table wider than its column pushed the whole PAGE
// sideways, so the sidebar scrolled off and every screen with a wide table broke below about
// 870px. Scrolling inside its own container keeps the page still — which is what backlog #52 was
// really about. It still establishes a clipping context, so the navy header's rounded corners are
// unaffected.
export const tableShell = "overflow-x-auto rounded-lg border border-border bg-card";
