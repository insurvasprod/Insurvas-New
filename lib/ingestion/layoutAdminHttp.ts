import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import type { AdminContext } from "@/lib/adminAuth/requireAdminRole";
import { canAccessConfigurationSection } from "@/lib/configuration/sections";

import { DATA_TYPES, TRANSFORMS } from "./layout";
import { LayoutMapError } from "./layoutAdmin";

/**
 * LA-4.3 · admin-route glue for layout maps. They belong to the carrier library, so they follow its
 * access rule (super_admin, platform_config), as LA-3.13's field maps do. Each route resolves the
 * admin itself and hands the result here.
 */
export function layoutAdmin(admin: AdminContext | null): { adminId: string } | NextResponse {
  if (!admin) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!canAccessConfigurationSection(admin.role, "carriers")) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return { adminId: admin.sub };
}

export function layoutFailure(error: unknown) {
  if (error instanceof LayoutMapError) return NextResponse.json({ error: error.message, problems: error.problems }, { status: error.status });
  console.error("[layout-maps]", error);
  return NextResponse.json({ error: "Something went wrong with the layout map. Try again." }, { status: 500 });
}

export const isId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);

export const createSchema = z.object({
  layout_key: z.string().regex(/^[a-z][a-z0-9_]{2,60}$/, "A layout key is lowercase letters, digits and underscores, like aetna_aflac_ahl_policies."),
  name: z.string().trim().min(1, "Name the layout.").max(120),
  file_type: z.enum(["policies", "commissions"]),
}).strict();

const entrySchema = z.object({
  source_column: z.string().min(1, "Every column needs its header, exactly as the file has it.").max(200),
  target_field: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/),
  data_type: z.enum(DATA_TYPES),
  transform: z.enum(TRANSFORMS),
  required: z.boolean(),
  enum_values: z.record(z.string().min(1).max(120), z.string().min(1).max(60)).nullable(),
}).strict();

export const saveSchema = z.object({
  name: z.string().trim().min(1).max(120),
  header_row_index: z.number().int().min(1).max(200).nullable(),
  sheet_name: z.string().trim().min(1).max(120).nullable(),
  row_count_swing_pct: z.number().int().min(1).max(1000),
  total_row_column: z.string().min(1).max(200).nullable(),
  total_row_value: z.string().min(1).max(200).nullable(),
  entries: z.array(entrySchema).max(200),
}).strict().refine((value) => (value.total_row_column === null) === (value.total_row_value === null), "A total row needs both its column and its value.");

export const assignmentSchema = z.object({
  carrier_id: z.string().refine(isId, "Choose the carrier."),
  file_type: z.enum(["policies", "commissions"]),
  layout_key: z.string().regex(/^[a-z][a-z0-9_]{2,60}$/),
}).strict();
