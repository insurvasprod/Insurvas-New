import { useEffect, useState } from "react";
import { View } from "react-native";

import { Button, Empty, Loading, Row, SearchBox, T, Toggle } from "@/components/ui";
import { FcChip, Mini, Seg, SheetModal } from "@/components/calls/parts";
import { stateName } from "@/components/calls/time";
import { codeLabel, phoneLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import type { QueueRow } from "./head-card";

/**
 * Board C7e · Dialer queue filters. Priority is the server's own filter (GET /api/app/dialer/queue
 * ?priority=); Campaign and Lead type narrow the list the server sent (the queue route has neither
 * filter, so the campaign chips are the campaigns on that list, never a made-up set, and a lead type is
 * read from each row: its tier, its campaign's lead type, a recycle pass, an open callback); Search finds
 * any lead by name or phone through GET /api/app/dialer/search (two characters at least) and opens it
 * without serving it. "Callable now only" is the server's own rule: the queue lists only leads inside
 * their calling window right now (dialer_queue_preview), so the switch is shown on and cannot be turned off.
 */
export type Priority = "all" | "high" | "medium" | "low";
export const PRIORITIES: { key: Priority; label: string }[] = [{ key: "all", label: "All" }, { key: "high", label: "High" }, { key: "medium", label: "Medium" }, { key: "low", label: "Low" }];

export type LeadKind = "fresh" | "aged" | "callbacks" | "recycled";
export const LEAD_KINDS: { key: LeadKind; label: string }[] = [{ key: "fresh", label: "Fresh" }, { key: "aged", label: "Aged" }, { key: "callbacks", label: "Callbacks" }, { key: "recycled", label: "Recycled" }];

/** Whether a queue row is of a lead type: only what the row carries from the server. */
export function isKind(r: QueueRow, kind: LeadKind): boolean {
  if (kind === "fresh") return r.tierName === "fresh" || r.tierName === "realtime";
  if (kind === "aged") return r.leadType === "aged";
  if (kind === "callbacks") return r.tierName === "callback" || Boolean(r.callbackAt);
  return Boolean(r.recycled);
}

type SearchLead = { id: string; product_line: string | null; values: Record<string, unknown> };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");
export function searchName(values: Record<string, unknown>): string {
  return text(values.full_name) || [text(values.first_name), text(values.last_name)].filter(Boolean).join(" ") || "Unnamed lead";
}

/** The campaigns on the list, most leads first; how many more there are past the shown four. */
export function campaignChoices(names: (string | null)[], shown = 4): { names: string[]; more: number } {
  const counts = new Map<string, number>();
  for (const n of names) if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  const all = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n);
  return { names: all.slice(0, shown), more: Math.max(0, all.length - shown) };
}

export function QueueSheet({ visible, onClose, priority, onPriority, campaign, onCampaign, campaigns, kind, onKind, autoNext, onAutoNext, showing, loading, focusSearch, onOpenLead }: {
  visible: boolean; onClose: () => void;
  priority: Priority; onPriority: (p: Priority) => void;
  campaign: string | null; onCampaign: (c: string | null) => void; campaigns: (string | null)[];
  kind: LeadKind | null; onKind: (k: LeadKind | null) => void;
  autoNext: boolean; onAutoNext: (v: boolean) => void;
  /** How many leads the list will show with these filters. */
  showing: number; loading: boolean;
  focusSearch?: boolean;
  onOpenLead: (leadId: string) => void;
}) {
  const { api } = useSession();
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [allCampaigns, setAllCampaigns] = useState(false);
  useEffect(() => { const h = setTimeout(() => setQ(query.trim()), 350); return () => clearTimeout(h); }, [query]);
  const found = useLoad(() => (q.length >= 2 ? api<{ leads: SearchLead[] }>(`/api/app/dialer/search?q=${encodeURIComponent(q)}&limit=20`) : Promise.resolve(null)), [q]);
  const choices = campaignChoices(campaigns, allCampaigns ? 1000 : 4);

  return (
    <SheetModal visible={visible} title="Queue" onClose={onClose}>
      <View style={{ gap: 8, paddingBottom: 8 }}>
        <SearchBox testID="queue-search" value={query} onChangeText={setQuery} placeholder="Name or phone" autoFocus={focusSearch} />
        {q.length >= 2 ? (
          found.loading && !found.data ? <Loading rows={2} /> : found.error ? (
            <T kind="small">{found.errorCode?.status === 403 ? "Search is for owners and producers." : found.error}</T>
          ) : (found.data?.leads ?? []).length ? (
            <View style={{ marginHorizontal: -16 }}>
              {(found.data?.leads ?? []).map((l, i) => (
                <Row key={l.id} testID={`queue-found-${l.id}`} first={i === 0} icon="user" iconTone="plain" title={searchName(l.values)}
                  meta={[phoneLabel(text(l.values.phone) || text(l.values.phone_number) || null), stateName(text(l.values.state) || null), codeLabel(l.product_line)].filter(Boolean).join(" · ")}
                  onPress={() => { onClose(); onOpenLead(l.id); }} />
              ))}
            </View>
          ) : <Empty icon="search" title="No leads match" body="Try a name or the last four digits of the phone." />
        ) : (
          <>
            <Mini style={{ marginTop: 8 }}>Priority</Mini>
            <Seg items={PRIORITIES} value={priority} onChange={(k) => onPriority(k as Priority)} />
            {choices.names.length ? (
              <>
                <Mini style={{ marginTop: 8 }}>Campaign</Mini>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {choices.names.map((n) => <FcChip key={n} testID={`queue-campaign-${n}`} label={n} on={campaign === n} onPress={() => onCampaign(campaign === n ? null : n)} />)}
                  {choices.more ? <FcChip label={`+ ${choices.more}`} on={false} onPress={() => setAllCampaigns(true)} /> : null}
                </View>
              </>
            ) : null}
            <Mini style={{ marginTop: 8 }}>Lead type</Mini>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {LEAD_KINDS.map((k) => <FcChip key={k.key} testID={`queue-kind-${k.key}`} label={k.label} on={kind === k.key} onPress={() => onKind(kind === k.key ? null : k.key)} />)}
            </View>
            <View style={{ marginTop: 6, marginHorizontal: -16 }}>
              {/* The server lists only leads inside their calling window now, so this one is always on. */}
              <Row first title="Callable now only" meta="Inside each customer’s calling window" right={<Toggle label="Callable now only" value disabled onChange={() => undefined} />} />
              <Row title="Auto-next" meta="Serve the next lead after each outcome" right={<Toggle label="Auto-next" value={autoNext} onChange={onAutoNext} />} />
            </View>
            <View style={{ flexDirection: "row", gap: 10, marginTop: 8 }}>
              <Button kind="outline" label="Clear" onPress={() => { onPriority("all"); onCampaign(null); onKind(null); }} style={{ flex: 1 }} />
              <Button testID="queue-show" label={loading ? "Show leads" : `Show ${showing.toLocaleString()} ${showing === 1 ? "lead" : "leads"}`} onPress={onClose} style={{ flex: 1 }} />
            </View>
          </>
        )}
      </View>
    </SheetModal>
  );
}
