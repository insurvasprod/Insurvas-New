import { PageHeader } from "@/components/ui/page-header";
import { PageLoading } from "@/components/ui/page-loading";
import { InboundStepBar } from "@/components/app/inbound/inbound-step-bar";

/**
 * The call page's frame while it loads (Basic walk 2026-11-20: Take this call looked like it did nothing).
 * Inbound and the call share the `inbound` segment, so the shell's loading.tsx never showed between them:
 * Incoming calls stayed on screen until the whole call page had rendered. This boundary draws the call's
 * step bar at once, on the same line InboundCall draws it, and the caller profile loads under it.
 *
 * It sits on `call`, not on `call/[workItemId]`: moving between the call's steps changes only `?phase=`,
 * which keeps the old step on screen until the next one is ready (the step slide) instead of a skeleton.
 */
export default function Loading() {
  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <PageHeader title="Call" hideTitle lead={<InboundStepBar current={1} />} />
      <PageLoading header={false} strip={false} rows={6} />
    </div>
  );
}
