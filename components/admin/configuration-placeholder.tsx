import { ArrowRight, Clock3 } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { ConfigurationSection } from "@/lib/configuration/sections";

export function ConfigurationPlaceholder({ section }: { section: ConfigurationSection }) {
  return (
    <Card>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2 text-[var(--color-accent-ink)]">
          <Clock3 className="size-5" />
          <p className="font-semibold">Section reserved for {section.owner}</p>
        </div>
        <p className="text-sm text-muted-foreground">
          {section.description} This route and permission boundary are ready; the section&apos;s own
          controls will be implemented by its ticket without changing the Configuration Center shell.
        </p>
        <p className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground">
          Independent save workflow will live here <ArrowRight className="size-4" />
        </p>
      </CardContent>
    </Card>
  );
}
