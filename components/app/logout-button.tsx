"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleLogout() {
    setLoading(true);
    await fetch("/api/app/auth/logout", { method: "POST" });
    router.push("/app/login");
    router.refresh();
  }

  return (
    <Button variant="outline" size="sm" onClick={handleLogout} disabled={loading} className="w-full justify-center">
      <LogOut className="size-4" />
      {loading ? "Signing out…" : "Sign out"}
    </Button>
  );
}
