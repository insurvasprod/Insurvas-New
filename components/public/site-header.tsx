import Link from "next/link";
import { Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SiteHeader() {
  return (
    <header className="border-b border-white/10 bg-[var(--brand-800)] text-white">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/pricing" className="flex items-center gap-2 font-extrabold tracking-tight">
          <span className="flex size-9 items-center justify-center rounded-xl bg-white/10">
            <Building2 className="size-5" />
          </span>
          Insurvas
        </Link>
        <nav className="flex items-center gap-2">
          <Button asChild variant="ghost" className="text-white hover:bg-white/10 hover:text-white">
            <Link href="/app/login">Sign in</Link>
          </Button>
          <Button asChild className="bg-white text-[var(--brand-800)] hover:bg-[var(--brand-50)]">
            <Link href="/signup">Start free trial</Link>
          </Button>
        </nav>
      </div>
    </header>
  );
}
