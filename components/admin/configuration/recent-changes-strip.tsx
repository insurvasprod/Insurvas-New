import { History } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { RecentConfigurationChange } from "@/lib/configuration/queries";

function formatWhen(value: string): string {
  return new Date(value).toLocaleString();
}

export function RecentChangesStrip({ changes }: { changes: RecentConfigurationChange[] }) {
  return (
    <Card data-testid="recent-configuration-changes">
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2">
          <History className="size-4 text-[var(--brand-700)]" />
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">Recently changed</h2>
          <span className="text-xs text-muted-foreground">Audit log</span>
        </div>

        {changes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No configuration changes have been recorded yet.</p>
        ) : (
          <ul className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
            {changes.map((change) => (
              <li key={change.id} className="min-w-0 rounded-md border border-border bg-muted/20 p-3">
                <p className="truncate text-sm font-semibold">{change.action}</p>
                <p className="mt-1 truncate text-xs text-muted-foreground">
                  {change.actor} · {formatWhen(change.ts)}
                </p>
                {change.target && <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{change.target}</p>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
