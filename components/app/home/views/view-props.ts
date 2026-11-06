import type { TenantContext } from "@/lib/tenantAuth/requireTenant";
import type { ProducerScope } from "@/lib/agency/visibilityCore";

/**
 * What every dashboard view gets (owner 2026-11-06, /app/dashboard?view=…). A view is an async server
 * component that reads its own module's data and renders `DashLayout` from components/app/home/dash.
 *
 * The rules every view keeps:
 *   - Read under `scope` (AG-0.5): a producer in an agency sees only their own and their downline's rows.
 *   - Show only what `available` and `context.role` open: a figure's link must be a page the reader can open
 *     (`firstOpenable` from lib/dashboard/roleHome); a figure whose page is closed to them is left out.
 *   - `noMoney` (a manager): no dollar figure anywhere.
 *   - Every tile, figure, row and list item links to the exact page behind it, filtered to what was clicked.
 *   - A read that fails leaves its card out or shows its empty line; it never throws the page.
 */
export type DashViewProps = {
  context: TenantContext;
  /** Plan features after kill switches. */
  available: readonly string[];
  /** AG-0.5 producer scope: null = the whole agency. */
  scope: ProducerScope;
  solo: boolean;
  /** The agency's IANA zone, for "today". */
  zone: string;
  /** This request's "now". */
  now: number;
  noMoney: boolean;
};
