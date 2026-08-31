import Link from "next/link";
import { Building2 } from "lucide-react";

export function OnboardingFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[linear-gradient(160deg,var(--brand-50),#f7f9fb_55%,#eaf1f9)] px-4 py-8">
      <div className="mx-auto max-w-3xl">
        <Link href="/pricing" className="mb-8 flex items-center justify-center gap-2 font-extrabold text-[var(--brand-800)]">
          <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--brand-700)] text-white"><Building2 className="size-5" /></span>
          Insurvas
        </Link>
        {children}
      </div>
    </div>
  );
}
