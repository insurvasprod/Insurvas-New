import { redirect } from "next/navigation";

/** No Lists page (manager 2026-10-29): lead lists live inside their campaign, on Source. */
export default function LeadListsPage() {
  redirect("/app/campaigns");
}
