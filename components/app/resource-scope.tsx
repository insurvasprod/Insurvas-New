"use client";

import { useEffect } from "react";

import { markHydrated, setResourceScope } from "@/lib/client/resource-cache";

/**
 * Files the tab's kept answers under who is signed in and in which workspace (lib/client/resource-cache.ts). Set
 * while rendering, ahead of the page in the shell, so the page's first read already sees the right scope. Once the
 * document has hydrated, pages may start from kept answers (`seed`).
 */
export function ResourceScope({ id }: { id: string }) {
  setResourceScope(id);
  useEffect(() => { markHydrated(); }, []);
  return null;
}
