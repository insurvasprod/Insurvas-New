import { redirect } from "next/navigation";

/** Verification is step 2 of the call page since Inbound A (2026-10-27): old links land there. */
export default async function VerificationPage({ params }: { params: Promise<{ workItemId: string }> }) {
  const { workItemId } = await params;
  redirect(`/app/inbound/call/${encodeURIComponent(workItemId)}`);
}
