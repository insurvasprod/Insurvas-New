import { redirect } from "next/navigation";

/** The call outcome is step 3 of the call page since Inbound A (2026-10-27): old links land there. */
export default async function DispositionPage({ params }: { params: Promise<{ workItemId: string }> }) {
  const { workItemId } = await params;
  redirect(`/app/inbound/call/${encodeURIComponent(workItemId)}?step=finish`);
}
