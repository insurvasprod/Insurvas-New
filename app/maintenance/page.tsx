import Link from "next/link";
import { Wrench } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getMaintenanceStatus } from "@/lib/system/service";

export default async function MaintenancePage() {
  const status = await getMaintenanceStatus();
  if (status.level !== "locked") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] p-4">
        <Card className="w-full max-w-lg">
          <CardContent className="space-y-4 p-6 text-center">
            <p className="text-lg font-semibold">The platform is available again.</p>
            <Button asChild><Link href="/app/login">Continue to sign in</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="items-center text-center">
          <div className="mb-2 flex size-12 items-center justify-center rounded-full bg-[var(--color-warning)]/15 text-[var(--color-warning)]">
            <Wrench className="size-6" />
          </div>
          <CardTitle>We&apos;ll be back shortly</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-center">
          <p className="text-sm text-muted-foreground">{status.message ?? "The platform is temporarily unavailable while maintenance is underway."}</p>
          {status.scheduledEnd && <p className="text-xs text-muted-foreground">Expected end: {new Date(status.scheduledEnd).toLocaleString()}</p>}
          <Button variant="outline" asChild><Link href="/admin/login">Admin sign in</Link></Button>
        </CardContent>
      </Card>
    </div>
  );
}
