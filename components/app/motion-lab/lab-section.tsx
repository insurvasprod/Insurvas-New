import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

/** One pattern on the motion lab: a title, a line on what to look for, the live specimen. */
export function Section({ title, note, onReplay, children }: { title: string; note: string; onReplay?: () => void; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-semibold text-[var(--ink)]">{title}</h3>
          <p className="text-sm text-[var(--body)]">{note}</p>
        </div>
        {onReplay && <Button variant="outline" onClick={onReplay}>Play again</Button>}
      </div>
      {children}
    </Card>
  );
}

/** A group of patterns: what is in the product now, and each tier waiting for sign-off. */
export function LabGroup({ title, note }: { title: string; note: string }) {
  return (
    <div className="pt-2">
      <h2 className="text-base font-semibold text-[var(--ink)]">{title}</h2>
      <p className="text-sm text-[var(--body)]">{note}</p>
    </div>
  );
}
