"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function AdminRouteError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the failure visible to the local developer without exposing database details in the UI.
    console.error("Admin route failed to render");
  }, []);

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center">
      <section
        aria-labelledby="admin-error-title"
        className="w-full rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-8 text-center shadow-sm"
      >
        <p className="text-xs font-semibold uppercase tracking-[0.02em] text-muted-foreground">Admin workspace</p>
        <h1 id="admin-error-title" className="mt-3 text-2xl font-semibold text-[var(--color-text)]">
          This page could not load
        </h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-[var(--color-muted)]">
          Something went wrong while loading this workspace. Try again, or return to the dashboard while the issue is investigated.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-[var(--color-primary)] px-4 py-2.5 text-sm font-semibold text-[var(--on-primary)] transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            Try again
          </button>
          <Link
            href="/admin"
            className="rounded-lg border border-[var(--color-border)] px-4 py-2.5 text-sm font-semibold text-[var(--color-text)] transition hover:bg-[var(--color-page-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-primary)]"
          >
            Back to dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}
