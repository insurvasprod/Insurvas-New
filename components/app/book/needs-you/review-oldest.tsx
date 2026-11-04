"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { searchParam } from "@/lib/needsYou/kinds";

/**
 * Needs you's "Review the oldest" (the title line's button). A client part only so it reads the list's search
 * as it is now (?q=, kept by replaceState while typing): the Review queue opens narrowed the same way, and its
 * "Done for now" comes back to the list with the search still in it (QA 2026-11-03).
 */
export function ReviewOldest({ fileId, view }: { fileId: string | null; view: string }) {
  const params = useSearchParams();
  const q = searchParam(params.get("q"));
  const back = new URLSearchParams({ view });
  if (fileId) back.set("file", fileId);
  if (q) back.set("q", q);
  const query = new URLSearchParams();
  if (fileId) query.set("file", fileId);
  if (q) query.set("q", q);
  query.set("from", `/app/needs-you?${back.toString()}`);
  return <Button asChild><Link href={`/app/needs-you/review?${query.toString()}`}>{q ? "Review these →" : "Review the oldest →"}</Link></Button>;
}
