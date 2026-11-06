"use client";

import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";

import { Button } from "@/components/ui/button";
import { control } from "@/components/ui/field";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleChip } from "@/components/ui/toggle-chip";
import type { BoardPipeline } from "@/lib/pipelineRules/store";
import { cn } from "@/lib/utils";

/**
 * "Only when the card is in" (round 6, owner 2026-11-06): one control that says the answer — "27 of 31 stages" — and
 * opens a picker: search, each pipeline with its count and All / None, the stages as chips. It was every stage of
 * every pipeline laid out as chips on the page. No stage picked means any stage.
 */
export function StagePicker({ board, value, onChange, disabled = false }: { board: BoardPipeline[]; value: string[]; onChange: (next: string[]) => void; disabled?: boolean }) {
  const [query, setQuery] = useState("");
  const pipelines = useMemo(() => board.map((p) => ({ ...p, stages: p.stages.filter((s) => !s.archived || value.includes(s.id)) })), [board, value]);
  const total = pipelines.reduce((sum, p) => sum + p.stages.length, 0);
  const picked = new Set(value);
  const q = query.trim().toLowerCase();
  const toggle = (id: string) => onChange(picked.has(id) ? value.filter((x) => x !== id) : [...value, id]);
  const setPipeline = (ids: string[], on: boolean) => onChange(on ? [...new Set([...value, ...ids])] : value.filter((x) => !ids.includes(x)));
  const label = value.length === 0 ? "Any stage" : `${value.length} of ${total} ${total === 1 ? "stage" : "stages"}`;
  const detail = value.length === 0 ? "pick stages to narrow it" : pipelines.map((p) => [p.name, p.stages.filter((s) => picked.has(s.id)).length, p.stages.length] as const).filter(([, n]) => n > 0).map(([name, n, of]) => (n === of ? `all of ${name}` : `${n} of ${name}`)).join(" · ");

  return (
    <div className="flex flex-col gap-1.5">
      <Popover>
        <PopoverTrigger asChild>
          <button id="rule-from" type="button" disabled={disabled} className={cn(control, "flex items-center justify-between text-left")} aria-label={`Only when the card is in: ${label}`}>
            <span className="truncate">{label}</span>
            <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(560px,calc(100vw-32px))] p-3">
          <input aria-label="Search stages" className={control} placeholder="Search stages" value={query} onChange={(e) => setQuery(e.target.value)} />
          <div className="mt-3 flex max-h-[360px] flex-col gap-3 overflow-y-auto">
            {pipelines.map((p) => {
              const shown = p.stages.filter((s) => !q || s.name.toLowerCase().includes(q));
              if (!shown.length) return null;
              const ids = p.stages.map((s) => s.id);
              const on = p.stages.filter((s) => picked.has(s.id)).length;
              return (
                <div key={p.id} className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span className="font-semibold">{p.name} · {on} of {p.stages.length}</span>
                    <button type="button" className="font-semibold text-[var(--accent-ink)] hover:underline" onClick={() => setPipeline(ids, on < ids.length)}>{on < ids.length ? "All" : "None"}</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {shown.map((s) => <ToggleChip key={s.id} selected={picked.has(s.id)} onClick={() => toggle(s.id)}>{s.name}</ToggleChip>)}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange([])}>Any stage</Button>
            <span className="text-xs text-muted-foreground">{label}</span>
          </div>
        </PopoverContent>
      </Popover>
      <span className="truncate text-xs text-muted-foreground" title={detail}>{detail}</span>
    </div>
  );
}
