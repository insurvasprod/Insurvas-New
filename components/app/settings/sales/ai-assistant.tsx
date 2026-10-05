"use client";

/**
 * Settings › Sales › AI assistant (board l3-set-ai, LA-3.3). BLOCKED on decision 4 — the provider,
 * and whether its terms allow health data. So this is the honest unavailable state: it reads
 * GET /api/app/ai-assistant/status, draws the switch off and disabled with the reason, and states
 * exactly what would and would not be sent. There is no save: nothing here can be changed until a
 * provider is chosen, and no provider is called anywhere.
 *
 * The two lists are fixed in code (SENSITIVE_FIELD_KEYS and the interview payload); an owner cannot
 * add or remove a line.
 */

import { useCallback, useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import { Callout, Field, SettingsCard, SettingsGrid, SettingsStack, ToggleRow, control } from "@/components/app/settings/primitives";
import { TableCard } from "@/components/ui/table-card";

import { SalesLoadError, SalesLoading, SalesPanelTop, useSalesSample } from "./shared";

type Status = { available: boolean; enabled: boolean; provider: string | null; reason: string; sends: string };

const SAMPLE: Status = {
  available: false, enabled: false, provider: null,
  reason: "Not available yet — waiting on the choice of AI provider and its terms for health data.",
  sends: "Health answers and medications are sent. Social Security numbers, banking details and full contact records are never sent.",
};

const SENT = [
  { label: "The question text", sub: "As the underwriting template words it" },
  { label: "The answer text", sub: "As the agent recorded it" },
  { label: "Medication names and doses", sub: "Name, dose, since when and what it is for" },
  { label: "The product", sub: "The product line being quoted" },
  { label: "The state", sub: "The client's state, for state rules" },
];
const NEVER = ["Name", "Social Security number", "Bank routing and account numbers", "Card numbers", "Home address", "Phone number", "Email address", "Date of birth", "Screenshots of any kind"];

export function SalesAiAssistant() {
  const sample = useSalesSample();
  const [status, setStatus] = useState<Status | null>(sample ? SAMPLE : null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!sample);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/app/ai-assistant/status", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok) setError(data?.error ?? "The assistant's status could not be loaded.");
      else {
        setStatus(data as Status);
        setError(null);
      }
    } catch {
      setError("Couldn't reach Insurvas. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (sample) return;
    const t = window.setTimeout(load, 0);
    return () => window.clearTimeout(t);
  }, [load, sample]);

  const why = status?.reason ?? SAMPLE.reason;

  return (
    <SettingsStack>
      <SalesPanelTop sample={sample} />
      {loading ? <SalesLoading label="Loading the assistant's status" columns={2} /> : error ? (
        <SalesLoadError message={error} onRetry={load} />
      ) : status && (
        <>
          {!status.available && <Callout tone="warning" title={`${why} It stays off until then.`} />}

          <SettingsCard title="Availability" sub="One switch for the whole agency.">
            <div className="flex flex-col gap-[18px]">
              {/* A disabled switch gets no pointer events, so the reason sits on its row. */}
              <div title={why}>
                <ToggleRow
                  id="sales-ai-underwriting"
                  title="The assistant is available on the Interview step"
                  help={status.enabled ? "On for every agent in this agency." : "Off. No request is made and nothing leaves this agency."}
                  checked={status.enabled}
                  disabled
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Provider" htmlFor="sales-ai-provider" hint="Chosen with Insurvas once its terms for health data are settled.">
                  <select id="sales-ai-provider" className={control} value={status.provider ?? ""} disabled title={why} onChange={() => undefined}>
                    <option value="">{status.provider ?? "Not chosen"}</option>
                  </select>
                </Field>
                <Field label="Data region" htmlFor="sales-ai-region" hint="Fixed once the switch is on.">
                  <select id="sales-ai-region" className={control} value="" disabled title={why} onChange={() => undefined}>
                    <option value="">Not chosen</option>
                  </select>
                </Field>
              </div>
            </div>
          </SettingsCard>

          <SettingsGrid>
            <TableCard title="Sent with every request" description="Fixed in code — an owner cannot add a field.">
              <ul className="m-0 list-none p-0">
                {SENT.map((item) => (
                  <li key={item.label} className="flex gap-2.5 border-t border-[var(--border)] px-4 py-2.5">
                    <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--success)]" />
                    <span className="min-w-0">
                      <span className="block text-[14px] leading-[1.5] text-[var(--body)]">{item.label}</span>
                      <span className="block text-[12px] leading-[1.5] text-[var(--muted)]">{item.sub}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </TableCard>
            <TableCard title="Never sent" description="Fixed in code — an owner cannot remove one.">
              <ul className="m-0 list-none p-0">
                {NEVER.map((label) => (
                  <li key={label} className="flex gap-2.5 border-t border-[var(--border)] px-4 py-2.5">
                    <X aria-hidden className="mt-0.5 size-4 shrink-0 text-[var(--error-ink)]" />
                    <span className="text-[14px] leading-[1.5] text-[var(--body)]">{label}</span>
                  </li>
                ))}
              </ul>
            </TableCard>
          </SettingsGrid>
        </>
      )}
    </SettingsStack>
  );
}
