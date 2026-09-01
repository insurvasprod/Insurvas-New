import type { TenantRole } from "@/lib/tenantAuth/roles";

/**
 * The dashboard tile contract. Modules register data here; the dashboard renderer does not
 * change when a new module adds a tile.
 */
export type DashboardTile = {
  key: string;
  label: string;
  description: string;
  empty_state: string;
  action_label: string;
  path: string;
  icon: string;
  required_feature?: string;
  required_roles?: readonly TenantRole[];
};

export const DASHBOARD_TILES: readonly DashboardTile[] = [
  {
    key: "setup.carriers",
    label: "Add your carriers",
    description: "Keep your carrier relationships and contract levels in one place.",
    empty_state: "No carriers have been added yet. Start with the carriers you are appointed with.",
    action_label: "Add carriers",
    path: "/app/settings",
    icon: "briefcase-business",
    required_feature: "book_of_business",
    required_roles: ["owner"],
  },
  {
    key: "setup.appointments",
    label: "Confirm your appointments",
    description: "Record the states and products you are appointed to sell.",
    empty_state: "No appointments are recorded yet. Confirm your carrier appointments next.",
    action_label: "Confirm appointments",
    path: "/app/settings",
    icon: "calendar-check",
    required_feature: "appointment_vault",
    required_roles: ["owner"],
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
