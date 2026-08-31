// Client-safe: no `server-only` import, because the audit log table paginates on the client.
//
// This lived in TWO places — app/api/admin/audit-log/route.ts and the audit-log page — with no
// link between them, so changing one silently gave the first page a different size from every
// page after it. SA-4.1 collapsed them here.
//
// Deliberately NOT a setting. SA-4.1's criterion names dunning days, trial length and expiry
// windows; a page size is a rendering detail, it is imported by client components, and one that
// could change mid-session would break the pagination arithmetic already on the page.
export const AUDIT_LOG_PAGE_SIZE = 20;
