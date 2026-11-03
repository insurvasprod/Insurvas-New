import { redirect } from "next/navigation";

/** Verification is a step of the call page (step 3 since 2026-10-28): old links land on it. */
export default async function VerificationPage({ params }: { params: Promise<{ workItemId: string }> }) {
  const { workItemId } = await params;
  redirect(`/app/inbound/call/${encodeURIComponent(workItemId)}?phase=verify`);
}
