import { AdminPageHeader } from "@/components/admin/page-header";
import { Card, CardContent } from "@/components/ui/card";

export default function ConfigurationCenterPage() {
  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Configuration Center"
        subtitle="Find every platform-wide setting by what it affects. Choose a section to view or change it."
      />
      <Card>
        <CardContent className="space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-[var(--brand-700)]">Platform-wide configuration</h2>
          <p className="text-sm text-muted-foreground">
            Each area has its own route and save workflow. Changes are recorded in the existing audit
            log, so there is one history for the whole control plane.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
