"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function PartnerLogoutButton() {
  const router = useRouter();
  async function logout() {
    await fetch("/api/partner/auth/logout", { method: "POST" });
    router.push("/partner/login");
    router.refresh();
  }
  return <Button variant="outline" size="sm" onClick={logout}>Sign out</Button>;
}
