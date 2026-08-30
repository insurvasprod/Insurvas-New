export default function ForbiddenPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[var(--color-page-bg)] p-8">
      <div className="max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <h1 className="text-2xl font-extrabold tracking-tight">Access denied</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your admin role does not have access to this Configuration Center section.
        </p>
      </div>
    </main>
  );
}
