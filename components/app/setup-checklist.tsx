import Link from "next/link";
import { Check } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { SetupChecklist as SetupChecklistData } from "@/lib/dashboard/checklist";

export function SetupChecklist({ checklist }: { checklist: SetupChecklistData }) {
  if (checklist.complete) return null;

  const percentage = Math.round((checklist.completed / checklist.total) * 100);

  // Only the next unfinished step gets the filled action. One primary per view is the rule, and on
  // a setup list it is also the useful answer: the reader wants to know which step to do now, not
  // to choose between four equally loud buttons.
  const nextIndex = checklist.steps.findIndex((step) => !step.complete);

  const actionLabel = (key: string) => {
    if (key === "carriers") return "Add carriers";
    if (key === "appointments") return "Review appointments";
    if (key === "statement") return "Upload statement";
    if (key === "lead-sources") return "Add lead sources";
    if (key === "phone") return "Connect phone";
    return "Open settings";
  };

  return (
    <Card className="portal-dashboard-setup">
      <CardContent className="space-y-6 p-6 sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold tracking-[-0.02em]">Get set up</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Complete these steps to start helping more families.
            </p>
          </div>
          <div
            className="flex min-w-[16rem] items-center gap-3"
            aria-label={`${checklist.completed} of ${checklist.total} complete`}
          >
            <span className="whitespace-nowrap text-sm text-muted-foreground">
              {checklist.completed} of {checklist.total} complete
            </span>
            <div
              className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label="Setup progress"
              aria-valuemin={0}
              aria-valuemax={checklist.total}
              aria-valuenow={checklist.completed}
            >
              <span
                className="block h-full rounded-full bg-[var(--primary)] transition-[width] duration-200"
                style={{ width: `${percentage}%` }}
              />
            </div>
          </div>
        </div>

        <ol className="portal-dashboard-setup-list">
          {checklist.steps.map((step, index) => (
            <li key={step.key}>
              <Link href={step.path} className="portal-dashboard-setup-row group">
                <span
                  className={`portal-dashboard-setup-icon ${step.complete ? "is-complete" : ""}`}
                  aria-hidden="true"
                >
                  {step.complete ? <Check className="size-3.5" strokeWidth={3} /> : null}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold">
                    <span className="mr-1.5 text-muted-foreground">{index + 1}.</span>
                    {step.label}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {step.complete
                      ? "This setup step is complete."
                      : "Connect this workspace setting before you start."}
                  </span>
                </span>

                {step.complete ? (
                  <span className="portal-dashboard-complete-pill">Completed</span>
                ) : (
                  <span
                    className={`portal-dashboard-setup-action ${index === nextIndex ? "" : "is-secondary"}`}
                  >
                    {actionLabel(step.key)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
