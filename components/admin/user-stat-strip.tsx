import { Users, UserCheck, UserMinus, UserX, CalendarPlus } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import type { UserStats } from "@/lib/users/list";

const TILES = [
  { key: "total", label: "Total users", icon: Users },
  { key: "active", label: "Active", icon: UserCheck },
  { key: "inactive", label: "Inactive", icon: UserMinus },
  { key: "suspended", label: "Suspended", icon: UserX },
  { key: "signed_up_this_month", label: "New this month", icon: CalendarPlus },
] as const;

export function UserStatStrip({ stats }: { stats: UserStats }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
      {TILES.map(({ key, label, icon: Icon }) => (
        <Card key={key}>
          <CardContent className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-muted-foreground">{label}</p>
              <p className="text-2xl font-semibold tracking-tight">{stats[key].toLocaleString()}</p>
            </div>
            <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--color-blue-faint)] text-[var(--color-blue)]">
              <Icon className="size-4" />
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
