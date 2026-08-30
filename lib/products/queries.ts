import "server-only";

import { getSupabaseServiceClient } from "@/lib/supabase/service";
import type { ProductRow } from "./constants";

export type { ProductRow };

const COLUMNS = "id, code, name, category, description, is_active, sort_order, created_at, updated_at";

/** The admin list includes archived products so they can be restored. */
export async function fetchProducts(options: { includeArchived: boolean } = { includeArchived: true }) {
  const supabase = getSupabaseServiceClient();
  let request = supabase.from("products").select(COLUMNS).order("sort_order").order("created_at");
  if (!options.includeArchived) request = request.eq("is_active", true);
  const { data, error } = await request;
  if (error) throw new Error(`Could not load products: ${error.message}`);
  return (data ?? []) as ProductRow[];
}

/** Shared by future template and agent-setting pickers: archived products are excluded. */
export function fetchProductsForPicker(): Promise<ProductRow[]> {
  return fetchProducts({ includeArchived: false });
}
