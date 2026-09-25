"use client";

import { FileSpreadsheet, Mail, PhoneOutgoing, Users } from "lucide-react";

import { usePrefersReducedMotion, useScrollProgress } from "@/components/marketing/motion";

/**
 * The board's problem statement, drawn: four tools float apart in 3D, and as the section scrolls
 * through the viewport they fall together into one Insurvas tile. Scroll-linked, so the reader
 * drives it; under reduced motion it shows the settled picture.
 */
const TOOLS = [
  { label: "Dialer", icon: PhoneOutgoing, from: { x: -230, y: -120, z: 120, r: -14 } },
  { label: "CRM", icon: Users, from: { x: 230, y: -110, z: 60, r: 12 } },
  { label: "Spend spreadsheet", icon: FileSpreadsheet, from: { x: -250, y: 120, z: 40, r: 10 } },
  { label: "Partner emails", icon: Mail, from: { x: 240, y: 130, z: 140, r: -10 } },
];

export function LandingConverge() {
  const { ref, progress } = useScrollProgress<HTMLDivElement>();
  const reduced = usePrefersReducedMotion();
  // 0 → 1 across the middle of the section's pass through the viewport.
  const t = reduced ? 1 : Math.min(1, Math.max(0, (progress - 0.2) / 0.4));
  const ease = 1 - Math.pow(1 - t, 3);

  return (
    <div ref={ref} aria-hidden="true" className="relative mx-auto h-[380px] w-full max-w-[640px]" style={{ perspective: 1200 }}>
      <div className="absolute inset-0" style={{ transformStyle: "preserve-3d", transform: `rotateX(${(1 - ease) * 18}deg) rotateY(${(1 - ease) * -12}deg)` }}>
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const k = 1 - ease;
          return (
            <div
              key={tool.label}
              className="absolute left-1/2 top-1/2 flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 shadow-[0_20px_50px_-16px_rgba(0,0,0,.35)]"
              style={{
                transform: `translate(-50%, -50%) translate3d(${tool.from.x * k}px, ${tool.from.y * k}px, ${tool.from.z * k}px) rotate(${tool.from.r * k}deg) scale(${1 - ease * 0.35})`,
                opacity: 1 - ease * 0.85,
              }}
            >
              <Icon className="size-4 text-muted-foreground" />
              <span className="whitespace-nowrap text-sm font-semibold text-foreground">{tool.label}</span>
            </div>
          );
        })}
        <div
          className="absolute left-1/2 top-1/2 flex items-center gap-3 rounded-2xl bg-[var(--primary)] px-6 py-4 text-[var(--on-primary)] shadow-[0_24px_70px_-12px_var(--primary)]"
          style={{ transform: `translate(-50%, -50%) scale(${0.6 + ease * 0.4})`, opacity: 0.15 + ease * 0.85 }}
        >
          <span className="inline-flex size-9 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--on-primary)_16%,transparent)] text-base font-semibold">I</span>
          <span>
            <span className="block text-lg font-semibold leading-tight">Insurvas</span>
            <span className="block text-xs opacity-80">one queue · one claim · one record</span>
          </span>
        </div>
      </div>
    </div>
  );
}
