"use client";

/**
 * Contracting › the side panel behind a Carriers or States card (owner, 2026-10-29: "press the
 * carrier or the state and show for the carrier all the states … for the state what carriers").
 *
 * One panel, two views that link to each other: a carrier lists the states it is appointed in (and
 * the ones applied for), each opening that state; a state lists the carriers held there, then the
 * rest of your carriers that are not, each opening that carrier. Back returns to the view before.
 * DetailPanel overlay (UI-CONSISTENCY §8, §11): the cards stay where they are underneath.
 */

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, ChevronRight } from "lucide-react";

import { ProgressLine, type CarrierProgress } from "@/components/app/settings/carrier-card";
import { Button } from "@/components/ui/button";
import { DetailPanel } from "@/components/ui/detail-panel";
import { StatusChip } from "@/components/ui/status-chip";
import { US_STATES } from "@/lib/appointments/constants";
import { cn } from "@/lib/utils";

export type DetailTarget = { kind: "carrier" | "state"; id: string };

type Carrier = { id: string; name: string };

/**
 * On the page body, not inside the settings card: the card's glass (backdrop-filter) would otherwise
 * become the panel's frame and squeeze it into the card instead of the window's right edge.
 */
export function ContractingDetail(props: Parameters<typeof DetailView>[0]) {
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- the body exists only in the browser
  useEffect(() => setReady(true), []);
  return ready ? createPortal(<DetailView {...props} />, document.body) : null;
}

function DetailView({
  target, canGoBack, onBack, onOpen, onClose, carriers, dotOf, levelOf, writingNumberOf, progressOf, isOff,
  appointedStatesOf, pendingStatesOf, carriersInState, onEditCarrier, onChange,
}: {
  target: DetailTarget;
  canGoBack: boolean;
  onBack: () => void;
  onOpen: (next: DetailTarget) => void;
  onClose: () => void;
  carriers: Carrier[];
  dotOf: (carrierId: string) => string;
  levelOf: (carrierId: string) => string | null;
  writingNumberOf: (carrierId: string) => string | null;
  progressOf: (carrierId: string) => CarrierProgress;
  isOff: (carrierId: string) => boolean;
  appointedStatesOf: (carrierId: string) => string[];
  pendingStatesOf: (carrierId: string) => string[];
  /** Your carriers ticked in a state today, pending included. */
  carriersInState: (code: string) => string[];
  onEditCarrier: (carrierId: string) => void;
  onChange: () => void;
}) {
  const back = canGoBack ? (
    <Button type="button" variant="ghost" size="sm" onClick={onBack}><ArrowLeft aria-hidden="true" />Back</Button>
  ) : null;

  if (target.kind === "carrier") {
    const carrier = carriers.find((row) => row.id === target.id);
    if (!carrier) return null;
    const appointed = appointedStatesOf(carrier.id);
    const pending = pendingStatesOf(carrier.id);
    const level = levelOf(carrier.id);
    const writing = writingNumberOf(carrier.id);
    return (
      <DetailPanel
        mode="overlay"
        onClose={onClose}
        actions={back}
        title={<span className="flex min-w-0 items-center gap-2"><span className={cn("size-2.5 shrink-0 rounded-full", dotOf(carrier.id))} aria-hidden="true" /><span className="truncate">{carrier.name}</span></span>}
        subtitle={[level ? `Level ${level}%` : null, writing ? `Writing number ${writing}` : null].filter(Boolean).join(" · ") || "No contract details yet"}
        status={<ProgressLine progress={progressOf(carrier.id)} switchedOff={isOff(carrier.id)} />}
        footer={<>
          <Button type="button" onClick={() => onEditCarrier(carrier.id)}>Edit Carrier</Button>
          <Button type="button" variant="outline" onClick={onChange}>Change States</Button>
        </>}
      >
        <StateSection title="Appointed In" codes={appointed} tone="good" empty="Not appointed in any state yet." onOpen={(code) => onOpen({ kind: "state", id: code })} />
        {pending.length > 0 && <StateSection title="Applied For" codes={pending} tone="info" onOpen={(code) => onOpen({ kind: "state", id: code })} />}
      </DetailPanel>
    );
  }

  const name = US_STATES.find(([code]) => code === target.id)?.[1] ?? target.id;
  const here = carriersInState(target.id);
  const held = carriers.filter((carrier) => here.includes(carrier.id));
  const missing = carriers.filter((carrier) => !here.includes(carrier.id));
  return (
    <DetailPanel
      mode="overlay"
      onClose={onClose}
      actions={back}
      title={<span className="flex min-w-0 items-baseline gap-2"><span className="font-mono text-xs text-[var(--muted)]">{target.id}</span><span className="truncate">{name}</span></span>}
      subtitle={held.length === carriers.length ? `All ${carriers.length} of your carriers` : `${held.length} of your ${carriers.length} carriers`}
      footer={<Button type="button" variant="outline" onClick={onChange}>Change Carriers or States</Button>}
    >
      <section className="flex flex-col gap-2">
        <SectionTitle title="Carriers Here" count={held.length} />
        {held.length === 0 ? <p className="m-0 text-sm text-[var(--muted)]">No carrier in {name} yet.</p> : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {held.map((carrier) => {
              const granted = appointedStatesOf(carrier.id).includes(target.id);
              return (
                <li key={carrier.id}>
                  <CarrierRow carrier={carrier} dot={dotOf(carrier.id)} onOpen={() => onOpen({ kind: "carrier", id: carrier.id })}>
                    <StatusChip tone={granted ? "good" : "info"}>{granted ? "Appointed" : "Applied For"}</StatusChip>
                  </CarrierRow>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {missing.length > 0 && (
        <section className="flex flex-col gap-2">
          <SectionTitle title={`Not In ${name}`} count={missing.length} />
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {missing.map((carrier) => (
              <li key={carrier.id}>
                <CarrierRow carrier={carrier} dot={dotOf(carrier.id)} muted onOpen={() => onOpen({ kind: "carrier", id: carrier.id })}>
                  <span className="text-xs text-[var(--muted)]">{appointedStatesOf(carrier.id).length} states</span>
                </CarrierRow>
              </li>
            ))}
          </ul>
        </section>
      )}
    </DetailPanel>
  );
}

function SectionTitle({ title, count }: { title: string; count: number }) {
  return (
    <h3 className="m-0 flex items-center gap-2 text-xs font-semibold tracking-wide text-[var(--muted)] uppercase">
      {title}<span className="tabular-nums">{count}</span>
    </h3>
  );
}

/** Every state as a small tile, three to a row, so all 51 fit the panel without scrolling. */
function StateSection({ title, codes, tone, empty, onOpen }: { title: string; codes: string[]; tone: "good" | "info"; empty?: string; onOpen: (code: string) => void }) {
  return (
    <section className="flex flex-col gap-2">
      <SectionTitle title={title} count={codes.length} />
      {codes.length === 0 ? <p className="m-0 text-sm text-[var(--muted)]">{empty}</p> : (
        <ul className="m-0 grid list-none grid-cols-3 gap-1 p-0">
          {codes.map((code) => {
            const name = US_STATES.find(([row]) => row === code)?.[1] ?? code;
            return (
              <li key={code} className="min-w-0">
                <button
                  type="button"
                  onClick={() => onOpen(code)}
                  title={`${name}: see its carriers`}
                  className="flex h-7 w-full min-w-0 items-center gap-1.5 rounded-md border border-[var(--border)] px-2 text-left text-xs text-[var(--body)] hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] hover:bg-[var(--primary-soft)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:outline-none"
                >
                  <span className={cn("size-1.5 shrink-0 rounded-full", tone === "good" ? "bg-[var(--accent-ink)]" : "bg-[var(--info)]")} aria-hidden="true" />
                  <span className="shrink-0 font-mono font-semibold text-[var(--ink)]">{code}</span>
                  <span className="min-w-0 truncate">{name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CarrierRow({ carrier, dot, muted, onOpen, children }: { carrier: Carrier; dot: string; muted?: boolean; onOpen: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-md border py-2 border-[var(--border)] px-3 text-left text-sm hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] hover:bg-[var(--primary-soft)] focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:outline-none",
        muted && "text-[var(--muted)]",
      )}
    >
      <span className={cn("size-2 shrink-0 rounded-full", dot, muted && "opacity-50")} aria-hidden="true" />
      <span className={cn("min-w-0 flex-1 truncate", muted ? "text-[var(--muted)]" : "font-medium text-[var(--ink)]")}>{carrier.name}</span>
      {children}
      <ChevronRight className="size-4 shrink-0 text-[var(--muted)]" aria-hidden="true" />
    </button>
  );
}
