import { redirect } from "next/navigation";

/**
 * Insight › Persistency moved into Book scorecards › Persistency (2026-10-08 overlap merge): one
 * persistency figure, read from the carriers' own files, instead of a second one built from
 * hand-entered policies that could disagree with it. The address stays so old links still land.
 */
export default function PersistencyPage() {
  redirect("/app/book-scorecards?view=persistency");
}
