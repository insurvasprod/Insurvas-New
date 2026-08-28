import { z } from "zod";

import { USER_SORT_COLUMNS, USER_STATUSES } from "./constants";

// Every list param goes through this before touching the database. `sort` in particular is
// interpolated into an ORDER BY, so it is an enum, never free text.
export const usersQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  status: z.enum(USER_STATUSES).optional(),
  plan: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  sort: z.enum(USER_SORT_COLUMNS).default("created_at"),
  dir: z.enum(["asc", "desc"]).default("desc"),
  signupFrom: z.string().date().optional(),
  signupTo: z.string().date().optional(),
  lastLoginFrom: z.string().date().optional(),
  lastLoginTo: z.string().date().optional(),
});

export type UsersQuery = z.infer<typeof usersQuerySchema>;

/** Parses raw URL search params, dropping empty strings so `?status=` behaves as "no filter". */
export function parseUsersQuery(params: URLSearchParams): UsersQuery {
  const raw: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    if (value !== "") raw[key] = value;
  }

  const parsed = usersQuerySchema.safeParse(raw);
  return parsed.success ? parsed.data : usersQuerySchema.parse({});
}
