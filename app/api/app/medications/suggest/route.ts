import { NextResponse } from "next/server";

import { db, isMissingSchema, rows } from "@/lib/applications/db";
import { failure } from "@/lib/applications/http";
import { requireFeatureRole } from "@/lib/tenantAuth/requireFeatureRole";

const LIMIT = 10;

/** `%`, `_` and `\` are LIKE wildcards; a typed "10%" must match the text, not everything. */
function likePrefix(q: string) {
  return `${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * LA-3.2 · medication autocomplete. Up to ten names from the platform list (`medication_names`)
 * that start with what the agent typed, case-insensitively. It only saves typing: a name that is
 * not on the list is still a valid answer, so an empty list is never an error. Platform rows —
 * the table has no tenant column and holds no tenant data.
 */
export async function GET(request: Request) {
  const auth = await requireFeatureRole("applications", ["owner", "producer"]);
  if (auth instanceof NextResponse) return auth;
  const q = (new URL(request.url).searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
  if (!q) return NextResponse.json({ names: [] });
  if (q.length > 60) return NextResponse.json({ error: "Type fewer letters to search." }, { status: 400 });
  try {
    const { data, error } = await db().from("medication_names").select("name").ilike("name", likePrefix(q)).order("name").limit(LIMIT);
    if (error && isMissingSchema(error)) return NextResponse.json({ names: [] });
    if (error) throw new Error(error.message);
    return NextResponse.json({ names: rows<{ name: string }>(data).map((r) => r.name) });
  } catch (error) {
    return failure(error);
  }
}
