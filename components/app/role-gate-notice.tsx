import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function RoleGateNotice({ featureLabel, detail }: { featureLabel: string; detail: string }) {
  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>{featureLabel} is not available for your role</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </CardContent>
      </Card>
    </div>
  );
}
