"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Ends the agent session and returns to sign in. `variant="link"` is the arrow link the onboarding
 * cards use ("Sign out →"); the default is the outlined button for a dark header.
 */
export function LogoutButton({ variant = "button", className }: { variant?: "button" | "link"; className?: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogout() {
    setError(null);
    setLoading(true);
    try {
      const response = await fetch("/api/app/auth/logout", { method: "POST" });
      if (!response.ok) throw new Error("Sign out could not be completed");
      router.push("/app/login");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sign out could not be completed");
      setLoading(false);
    }
  }

  if (variant === "link") {
    return (
      <span className="inline-flex flex-col items-center">
        <button type="button" onClick={handleLogout} disabled={loading} aria-busy={loading} className={className}>
          {loading ? "Signing out…" : "Sign out"}
          <ArrowRight className="size-[13px] stroke-[2.4]" aria-hidden="true" />
        </button>
        {error && <span role="alert" className="mt-1 text-xs text-[var(--error-ink)]">{error}</span>}
      </span>
    );
  }

  return (
    <div className="portal-signout-wrap">
      <Button
        variant="outline"
        size="sm"
        onClick={handleLogout}
        disabled={loading}
        aria-busy={loading}
        className="portal-signout-button w-full justify-center border-white/20 bg-transparent text-white hover:bg-white/10 hover:text-white"
      >
        <LogOut className="size-4" />
        {loading ? "Signing out…" : "Sign out"}
      </Button>
      {error && <p role="alert" className="portal-signout-error">{error}</p>}
    </div>
  );
}
