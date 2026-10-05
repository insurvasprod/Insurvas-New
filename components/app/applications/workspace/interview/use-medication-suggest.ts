"use client";

/**
 * Medication autocomplete (LA-3.2). Live: up to ten names from the seeded `medication_names` list
 * that start with what was typed (GET /api/app/medications/suggest). Sample, or when the list cannot
 * be reached: the short local list below. Either way it only suggests — anything can be typed.
 */

import { useEffect, useMemo, useState } from "react";

/** The medications final-expense clients most often take; the design preview's stand-in list. */
export const COMMON_FE_MEDICATIONS = [
  "Albuterol", "Allopurinol", "Amlodipine", "Atorvastatin", "Carvedilol",
  "Clopidogrel (Plavix)", "Digoxin", "Donepezil", "Eliquis", "Furosemide", "Gabapentin", "Glipizide",
  "Hydrochlorothiazide", "Insulin glargine", "Insulin lispro", "Isosorbide mononitrate", "Levothyroxine",
  "Lisinopril", "Losartan", "Metformin", "Metoprolol", "Nitroglycerin", "Omeprazole", "Pantoprazole",
  "Prednisone", "Rivaroxaban (Xarelto)", "Sertraline", "Simvastatin", "Spironolactone", "Tamsulosin",
  "Tiotropium", "Tramadol", "Warfarin",
] as const;

const LIMIT = 10;
const DELAY = 180;

export function localSuggestions(query: string) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return COMMON_FE_MEDICATIONS.filter((m) => m.toLowerCase().startsWith(q)).slice(0, LIMIT);
}

export function useMedicationSuggest(query: string, sample: boolean): string[] {
  const q = query.trim();
  const [live, setLive] = useState<{ q: string; names: string[] } | null>(null);
  const [offline, setOffline] = useState(false);
  const useLocal = sample || offline;

  useEffect(() => {
    if (useLocal || !q) return;
    let current = true;
    const t = setTimeout(() => {
      fetch(`/api/app/medications/suggest?q=${encodeURIComponent(q)}`, { cache: "no-store" })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!current) return;
          if (!res.ok || !Array.isArray(data?.names)) { setOffline(true); return; }
          setLive({ q, names: (data.names as unknown[]).filter((n): n is string => typeof n === "string").slice(0, LIMIT) });
        })
        .catch(() => { if (current) setOffline(true); });
    }, DELAY);
    return () => { current = false; clearTimeout(t); };
  }, [q, useLocal]);

  const local = useMemo(() => localSuggestions(q), [q]);
  if (!q) return [];
  if (useLocal) return local;
  // Keep showing the last answer while the next one is on its way, so the list does not flicker.
  return live?.names ?? [];
}
