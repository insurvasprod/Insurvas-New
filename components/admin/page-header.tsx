// Matches the Insurvas CRM's page-header typography convention
// (components/agent-commissions/CommissionsPageHeader.tsx): bold dark title, muted subtitle.
export function AdminPageHeader({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div>
      <h1 className="text-2xl font-extrabold tracking-tight text-foreground">{title}</h1>
      <p className="mt-1 text-sm font-medium text-muted-foreground">{subtitle}</p>
    </div>
  );
}
