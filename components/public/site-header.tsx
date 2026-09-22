import Link from "next/link";
import { Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/pricing" className="flex items-center gap-2 font-semibold tracking-[-0.02em]">
          <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--soft-orange-surface)] text-[var(--primary)]">
            <Building2 className="size-5" />
          </span>
          Insurvas
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost">
            <Link href="/app/login">Sign in</Link>
          </Button>
          <Button asChild className="rounded-full px-5">
            <Link href="/signup">Start free trial</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
