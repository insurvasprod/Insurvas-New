import type { TenantRole } from "@/lib/tenantAuth/roles";

/**
 * The dashboard tile contract. Modules register data here; the dashboard renderer does not
 * change when a new module adds a tile.
 */
export type DashboardTile = {
  key: string;
  label: string;
  description: string;
  /**
   * A standing sentence about how the screen works — **not** an empty state.
   *
   * It was called `empty_state`, and `DashboardTile` renders it unconditionally, with no count
   * behind it. Nine of the eleven entries were already written as hints; the two setup tiles took
   * the old name at its word and asserted emptiness as fact:
   *
   *   "No carriers have been added yet."      — the demo tenant has 5 carriers
   *   "No appointments are recorded yet."     — the demo tenant has 38 appointments
   *
   * So the dashboard told an agent their setup was empty while the grid two clicks away was full
   * of it. LA-0.3's own in-scope line asks for the opposite: *"Empty states that say what to do
   * next rather than 'no data'."*
   *
   * Renamed rather than made conditional on purpose. A real empty state needs a count per tile,
   * and this page has a one-second budget that a fan-out of count queries would spend. A sentence
   * that is true whether or not the screen has rows costs nothing and cannot lie.
   */
  hint: string;
  action_label: string;
  path: string;
  icon: string;
  required_feature?: string;
  required_roles?: readonly TenantRole[];
};

/**
 * The tiles a dashboard can show.
 *
 * For a long time this list held two entries and both were `required_roles: ["owner"]`, so
 * `visibleDashboardTiles` returned nothing for a producer, setter, assistant or bookkeeper and the
 * dashboard fell through to "Your workspace is waiting for its first feature — ask your account
 * owner to activate a workspace feature". That is false for a producer on a twenty-feature plan,
 * and it sent them to their owner for a problem the owner could not fix.
 *
 * Every role that has work now has somewhere to go from here. Each tile carries its own feature and
 * roles, so the entitlement model is unchanged: a tile is only ever shown to someone who could
 * already open the page it points at.
 *
 * Every `path` below is a built screen. Adding a tile for an unbuilt destination would send the
 * reader to the coming-soon page from their own dashboard.
 */
export const DASHBOARD_TILES: readonly DashboardTile[] = [
  // ── Setup. Owner-only, because only an owner can act on them. ──────────────────────────────
  {
    key: "setup.carriers",
    label: "Add your carriers",
    description: "Keep your carrier relationships and contract levels in one place.",
    hint: "Start with the carriers you are appointed with, and record your contract level for each.",
    action_label: "Add carriers",
    path: "/app/settings#carrier-library",
    icon: "briefcase-business",
    required_feature: "book_of_business",
    required_roles: ["owner"],
  },
  {
    key: "setup.appointments",
    label: "Confirm your appointments",
    description: "Record the states and products you are appointed to sell.",
    hint: "Tick the states you are appointed in, carrier by carrier — the grid takes all of them at once.",
    action_label: "Confirm appointments",
    path: "/app/settings#states-licences",
    icon: "calendar-check",
    required_feature: "appointment_vault",
    required_roles: ["owner"],
  },

  // ── LA-1. Inbound work, for the people who do it. ──────────────────────────────────────────
  {
    key: "work.inbound",
    label: "Inbound transfers",
    description: "Waiting transfers, their screening signals, and the next one to claim.",
    hint: "Claiming is atomic — a transfer you claim leaves every other agent's inbox.",
    action_label: "Open the inbox",
    path: "/app/inbound",
    icon: "phone-incoming",
    required_feature: "inbound_transfers",
    required_roles: ["owner", "producer", "assistant"],
  },
  {
    key: "work.floor",
    label: "Agent Floor",
    description: "The live view of waiting transfers, active calls, and who is free.",
    hint: "Set your availability before the queue starts routing to you.",
    action_label: "Open the floor",
    path: "/app/floor",
    icon: "radio-tower",
    required_feature: "inbound_transfers",
    required_roles: ["owner", "producer", "assistant"],
  },

  // ── LA-2. Outbound work. ───────────────────────────────────────────────────────────────────
  {
    key: "work.dialer",
    label: "Dialer",
    description: "Work the next eligible lead, with compliance checked before every call.",
    hint: "Every number is screened server-side immediately before it is dialled.",
    action_label: "Open the dialer",
    path: "/app/dialer",
    icon: "phone-outgoing",
    required_feature: "outbound_dialing",
    required_roles: ["owner", "producer"],
  },
  {
    key: "work.assignments",
    label: "Lead assignment",
    description: "The pool, your capacity, and the rules that decide who gets what.",
    hint: "Rules are evaluated top to bottom; the first match assigns the lead.",
    action_label: "Open assignments",
    path: "/app/assignments",
    icon: "route",
    required_feature: "outbound_dialing",
    required_roles: ["owner", "producer", "assistant", "setter"],
  },
  {
    key: "insight.activity",
    label: "Activity & scorecard",
    description: "What was dialled, what came of it, and how it compares.",
    hint: "A setter sees their own numbers; an owner sees the team's.",
    action_label: "Open the scorecard",
    path: "/app/activity",
    icon: "list-checks",
    required_feature: "outbound_dialing",
    required_roles: ["owner", "producer", "setter"],
  },

  // ── Shared. ────────────────────────────────────────────────────────────────────────────────
  {
    key: "work.callbacks",
    label: "Callbacks",
    description: "Commitments you made, in the customer's timezone.",
    hint: "Overdue callbacks are listed first, with how late they are.",
    action_label: "Open the calendar",
    path: "/app/callbacks",
    icon: "calendar-check",
    required_feature: "callback_calendar",
    required_roles: ["owner", "producer", "assistant"],
  },
  {
    key: "work.leads",
    label: "Lead workspace",
    description: "Capture, filter, and move leads through your pipeline.",
    hint: "Board view moves a lead between stages; table view is for scanning and export.",
    action_label: "Open leads",
    path: "/app/leads",
    icon: "contact-round",
    required_feature: "book_of_business",
    required_roles: ["owner", "producer", "assistant"],
  },

  // ── Money. Bookkeepers see these and no call operations. ───────────────────────────────────
  {
    key: "book.policies",
    label: "Policies",
    description: "Your book of business, with premium, carrier, and renewal state.",
    hint: "Import a carrier file or add a policy manually to begin.",
    action_label: "Open policies",
    path: "/app/policies",
    icon: "book-open",
    required_feature: "book_of_business",
    required_roles: ["owner", "producer", "bookkeeper"],
  },
  {
    key: "book.ledger",
    label: "Commission ledger",
    description: "Every commission traced back to the policy or statement behind it.",
    hint: "Nothing is recorded without a source.",
    action_label: "Open the ledger",
    path: "/app/ledger",
    icon: "receipt",
    required_feature: "commission_ledger",
    required_roles: ["owner", "producer", "bookkeeper"],
  },
];

export function visibleDashboardTiles(
  grantedFeatureKeys: Iterable<string>,
  role: TenantRole = "owner",
): DashboardTile[] {
  const granted = new Set(grantedFeatureKeys);
  return DASHBOARD_TILES.filter((tile) =>
    (!tile.required_feature || granted.has(tile.required_feature)) &&
    (!tile.required_roles || tile.required_roles.includes(role)),
  );
}
