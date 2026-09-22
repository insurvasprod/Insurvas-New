/**
 * The three constants every admin table shares.
 *
 * The header used to be a filled navy band with white uppercase labels, which made a table read as
 * a thing with a title bar sitting inside the card. In this system a table is border-led: the
 * header is the muted band, its labels are the uppercase `label` style in muted ink, and the rules
 * do the separating. Changing them here changes all 22 tables.
 */
export const tableHeaderRow = "border-0 bg-muted hover:bg-muted";
export const tableHeadCell =
  "text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground whitespace-nowrap";
// overflow-x-auto, not overflow-hidden: a table wider than its column pushed the whole PAGE
// sideways, so the sidebar scrolled off and every screen with a wide table broke below about
// 870px. Scrolling inside its own container keeps the page still — which is what backlog #52 was
// really about. It still establishes a clipping context, so the header band's corners are clipped
// to the card's radius.
export const tableShell = "overflow-x-auto rounded-lg border border-border bg-card";
