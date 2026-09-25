import { NotFoundNotice } from "@/components/app/not-found-notice";
import { PageHeader } from "@/components/ui/page-header";

/** A missing page inside the agent app keeps the rail and top bar, as p-gate-404 draws it. */
export default function AgentNotFound() {
  return (
    <div className="m-stagger flex min-h-0 flex-grow flex-col gap-6">
      <PageHeader title="Not found" />
      <div className="flex min-h-0 flex-grow items-center justify-center">
        <NotFoundNotice />
      </div>
    </div>
  );
}
