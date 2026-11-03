"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Solo mode for the client side of the shell (owner 2026-10-29): the shell layout reads
 * isSoloWorkspace (lib/tenantTeam/solo.ts) once per request and provides it here, so the parts of a page
 * that hand work to someone else (Give to…, Assigned to me, the assign drawer) can leave themselves out
 * without a fetch of their own. Outside the shell it is false: the full app.
 */
const SoloContext = createContext(false);

export function SoloProvider({ solo, children }: { solo: boolean; children: ReactNode }) {
  return <SoloContext.Provider value={solo}>{children}</SoloContext.Provider>;
}

/** True when this individual agent works alone: no other setter or agent on the workspace. */
export function useSolo(): boolean {
  return useContext(SoloContext);
}
