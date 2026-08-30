"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LogoutButton({ compact = false }: { compact?: boolean } = {}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch("/api/admin/auth/logout", { method: "POST" });
    router.push("/admin/login");
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={handleLogout}
      disabled={loading}
      title={compact ? "Sign out" : undefined}
      aria-label={compact ? "Sign out" : undefined}
      className="w-full justify-center border-white/20 bg-transparent text-white hover:bg-white/10"
    >
      <LogOut className="size-4" />
      {!compact && (loading ? "Signing out…" : "Sign out")}
    </Button>
  );
}
