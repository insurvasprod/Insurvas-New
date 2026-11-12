/**
 * The addresses that open as a panel from the right when followed from inside the app (owner 2026-11-12): each has an
 * intercepting route in its shell's `@sheet` slot (app/app/(shell)/@sheet, app/admin/(protected)/@sheet) and a full
 * page for a refresh or a shared link. lib/design/routeSheets.test.mjs keeps this list and those folders in step.
 *
 * While one is open over a page the address is the form's, so the shell's own chrome (the trail, the sidebar, the
 * page's entrance) reads the page underneath instead — components/ui/page-pathname.ts.
 */
export const SHEET_ROUTES: readonly string[] = [
  "/app/producers/invite",
  "/app/complaints/new",
  "/app/deletion-requests/new",
  "/app/tcpa/exemptions/new",
  "/app/expenses/new",
  "/app/vendor-bills/new",
  "/app/servicing/new",
  "/app/book-setup/pipeline-rules/new",
  "/app/compliance/settings/holds/new",
  "/app/compliance/settings/deadlines/new",
  "/admin/layout-maps/new",
];

export function isSheetRoute(pathname: string): boolean {
  return SHEET_ROUTES.includes(pathname.replace(/\/$/, ""));
}
