/**
 * Admin › Users list: the query the screen and GET /api/admin/users accept.
 *
 * lib/users/query.ts (the original schema) plus the board's facets: the lifecycle state, one tenant
 * and one tenant role. The raw `status` filter stays accepted so any older caller keeps working;
 * the screen filters by `state`, which follows the one seat rule.
 *
 * Plain module: the client builds its URL from the same names.
 */
import { z } from "zod";

import { usersQuerySchema } from "../users/query.ts";
import { TENANT_ROLES } from "../tenantAuth/roles.ts";
import { USER_LIFECYCLES } from "./lifecycle.ts";

export const usersListQuerySchema = usersQuerySchema.extend({
  state: z.enum(USER_LIFECYCLES).optional(),
  /** One tenant's id, or NO_TENANT for people who belong to no agency (review before any clean-up). */
  tenant: z.union([z.string().uuid(), z.literal("none")]).optional(),
  role: z.enum(TENANT_ROLES).optional(),
  /** "1" asks the list route to return the tiles too (after a write, when they may have moved). */
  stats: z.enum(["1"]).optional(),
});

/** The tenant filter's value for people in no agency. */
export const NO_TENANT = "none";

export type UsersListQuery = z.infer<typeof usersListQuerySchema>;

/** Raw URL params → a valid query. Empty strings are "no filter"; anything invalid is the default. */
export function parseUsersListQuery(params: URLSearchParams): UsersListQuery {
  const raw: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (value !== "") raw[key] = value;
  }
  const parsed = usersListQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : usersListQuerySchema.parse({});
}

/** The facets the chip row shows, in the board's order. */
export type UsersListFacets = {
  state: string;
  plan: string;
  role: string;
  tenant: string;
  signupFrom: string;
  signupTo: string;
  lastLoginFrom: string;
  lastLoginTo: string;
};

export const EMPTY_FACETS: UsersListFacets = {
  state: "",
  plan: "",
  role: "",
  tenant: "",
  signupFrom: "",
  signupTo: "",
  lastLoginFrom: "",
  lastLoginTo: "",
};

/** How many filters the Filters button counts (the tenant picker and search sit outside it). */
export function activeFilterCount(facets: UsersListFacets): number {
  let n = 0;
  if (facets.state) n += 1;
  if (facets.plan) n += 1;
  if (facets.role) n += 1;
  if (facets.signupFrom || facets.signupTo) n += 1;
  if (facets.lastLoginFrom || facets.lastLoginTo) n += 1;
  return n;
}

export function usersListSearchParams(input: {
  q: string;
  facets: UsersListFacets;
  sort: string;
  dir: "asc" | "desc";
  page: number;
  stats?: boolean;
}): URLSearchParams {
  const params = new URLSearchParams();
  if (input.q) params.set("q", input.q);
  for (const [key, value] of Object.entries(input.facets)) {
    if (value) params.set(key, value);
  }
  params.set("sort", input.sort);
  params.set("dir", input.dir);
  params.set("page", String(input.page));
  if (input.stats) params.set("stats", "1");
  return params;
}
