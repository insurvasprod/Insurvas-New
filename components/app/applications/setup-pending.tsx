import { PageHeader } from "@/components/ui/page-header";

/**
 * Shown while an LA-3 screen's migration has not been applied. One actionable line, no essay: the
 * screen is not broken, its tables do not exist yet.
 */
export function SetupPending({ title }: { title: string }) {
  return (
    <div className="m-stagger flex flex-col gap-6">
      <PageHeader title={title} />
      <p role="alert" className="rounded-md border border-[var(--border)] border-l-[3px] border-l-[var(--warning)] bg-[var(--warning-surface)] px-3 py-2 text-sm text-[var(--warning-ink)]">
        This isn&apos;t set up yet — its database update has not been applied. Ask your Insurvas admin to apply the LA-3 migrations.
      </p>
    </div>
  );
}
