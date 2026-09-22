import Link from "next/link";
import { Building2 } from "lucide-react";

export function OnboardingFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--canvas)] px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/pricing" className="mb-8 flex items-center justify-center gap-2 font-semibold tracking-[-0.02em] text-foreground">
          <span className="flex size-9 items-center justify-center rounded-lg bg-[var(--soft-orange-surface)] text-[var(--primary)]"><Building2 className="size-5" /></span>
          Insurvas
        </Link>
        {children}
      </div>
    </div>
  );
}
