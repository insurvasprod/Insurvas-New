"use client";

/**
 * Carrier reference checks for submission capture (LA-3.15), asked of the server as the agent types:
 * the carrier's `reference_pattern`, and the same reference on another application in the agency.
 * Both are warnings, never blocks — the carrier's confirmation screen is the authority.
 */

import { useEffect, useState } from "react";

import { attemptUrl, request } from "./api";

export type ReferenceCheck = {
  format: "match" | "mismatch" | "unknown";
  example: string | null;
  carrierName: string | null;
  duplicate: { applicationId: string; caseId: string; clientName: string; submittedAt: string; attemptNo: number; sameCase: boolean } | null;
};

const EMPTY: ReferenceCheck = { format: "unknown", example: null, carrierName: null, duplicate: null };

export function useReferenceCheck(attemptId: string, reference: string, sample: boolean) {
  const ref = reference.trim();
  const [result, setResult] = useState<{ ref: string; check: ReferenceCheck }>({ ref: "", check: EMPTY });
  useEffect(() => {
    if (sample || !ref) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      const r = await request<ReferenceCheck>(`${attemptUrl(attemptId, "/reference-check")}?reference=${encodeURIComponent(ref)}`);
      if (live && r.ok) setResult({ ref, check: r.data });
    }, 350);
    return () => { live = false; window.clearTimeout(timer); };
  }, [attemptId, ref, sample]);
  return result.ref === ref ? result.check : EMPTY;
}

/** The carrier's reference shape, for the field hint, even before anything is typed. */
export function useReferenceExample(attemptId: string, sample: boolean) {
  const [example, setExample] = useState<{ example: string | null; carrierName: string | null } | null>(null);
  useEffect(() => {
    if (sample) return;
    let live = true;
    void request<ReferenceCheck>(`${attemptUrl(attemptId, "/reference-check")}?reference=0`).then((r) => {
      if (live && r.ok) setExample({ example: r.data.example, carrierName: r.data.carrierName });
    });
    return () => { live = false; };
  }, [attemptId, sample]);
  return example;
}
