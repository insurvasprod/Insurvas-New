import { redirect } from "next/navigation";

/**
 * AG-1.6 · New split is a dialog on the list now (round 7, owner pick 8·A, 2026-11-10): this address lands there,
 * `?new=1`, keeping a Change link's prefill (`?carrier&policy&writer&other&share`).
 */
export default async function NewSplitPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const asked = await searchParams;
  const q = new URLSearchParams({ new: "1" });
  for (const key of ["carrier", "policy", "writer", "other", "share"]) {
    const value = asked[key];
    if (typeof value === "string" && value) q.set(key, value.slice(0, 120));
  }
  redirect(`/app/commission-splits?${q}`);
}
