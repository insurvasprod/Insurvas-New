import { useEffect, useState } from "react";
import { Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { type IconName } from "@/components/icon";
import { Chip, Empty, F, FilterChips, Group, IconButton, IOS, Loading, Row, SearchBox } from "@/components/ui";
import type { Tone } from "@/theme/tokens";
import { appHrefFor } from "@/lib/links";
import { currentTabs } from "@/lib/nav";
import { readSecret, writeSecret } from "@/lib/secure";
import { useSession } from "@/lib/session";
import type { SearchHit } from "@/lib/types";
import { usePalette } from "@/theme/use-palette";

/** A record shows its type icon, never an avatar (board B4). */
const GROUP_ICON: Record<string, IconName> = { Leads: "user", Policies: "book", "Lead lists": "list", Partners: "handshake", Pages: "file", Settings: "settings", Actions: "arrowUR" };
const RECENT_MAX = 5;

/**
 * Board B4's chips, always these five in this order; each shows the answer's groups it covers (All shows every
 * group). Cases covers retention cases and application cases, which the web's search does not return yet, so
 * it finds nothing until it does.
 */
const KINDS: { key: string; groups: string[] | null }[] = [
  { key: "All", groups: null },
  { key: "Leads", groups: ["Leads"] },
  { key: "Policies", groups: ["Policies"] },
  { key: "Cases", groups: ["Retention cases", "Cases", "Applications"] },
  { key: "Pages", groups: ["Pages", "Settings", "Actions"] },
];

/** A policy hit as drawn: the insured as the title, number and carrier as the line, the status as a chip. */
function policyLook(h: SearchHit): { title: string; meta: string | null; status: string | null } {
  const [number, ...name] = h.title.split(" · ");
  const parts = (h.meta ?? "").split(" · ").filter(Boolean);
  const status = parts.length >= 3 ? parts[parts.length - 1] : null;
  const carrier = parts[0] ?? null;
  return name.length ? { title: name.join(" · "), meta: [number, carrier].filter(Boolean).join(" · "), status } : { title: h.title, meta: h.meta, status };
}

function statusTone(status: string): Tone {
  if (/force|active|issued|paid/i.test(status)) return "ok";
  if (/lapse|cancel|terminat|declin|surrender/i.test(status)) return "bad";
  if (/pend|grace|risk/i.test(status)) return "warn";
  return "neutral";
}

/**
 * Board B4 · Search everything: the web's search (/api/app/search), one tap from every home. The filter
 * chips are the board's five (KINDS). Policies read as drawn (insured, number · carrier, status chip). Recent searches stay on this phone only, per person.
 * Hits the phone can't open go to the computer hand-off.
 */
export default function Search() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const { api, me } = useSession();
  const [q, setQ] = useState("");
  const [kind, setKind] = useState("All");
  const [answer, setAnswer] = useState<{ for: string; hits: SearchHit[] } | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const query = q.trim();
  const recentKey = me ? `insurvas.recentSearch.${me.user.id}` : null;

  useEffect(() => {
    if (!recentKey) return;
    let live = true;
    void readSecret(recentKey).then((raw) => {
      if (!live || !raw) return;
      try { const list = JSON.parse(raw) as unknown; if (Array.isArray(list)) setRecent(list.filter((x): x is string => typeof x === "string").slice(0, RECENT_MAX)); } catch { /* unreadable: start again */ }
    });
    return () => { live = false; };
  }, [recentKey]);

  useEffect(() => {
    if (query.length < 2) return;
    let live = true;
    const h = setTimeout(() => {
      api<{ hits: SearchHit[] }>(`/api/app/search?q=${encodeURIComponent(query)}&limit=20`)
        .then((r) => { if (live) setAnswer({ for: query, hits: r.hits }); }, () => { if (live) setAnswer({ for: query, hits: [] }); });
    }, 250);
    return () => { live = false; clearTimeout(h); };
  }, [query, api]);

  // Shown only for the query on screen; a newer query shows the loading rows until its answer lands.
  const hits = query.length < 2 ? null : answer?.for === query ? answer.hits : null;
  const busy = query.length >= 2 && answer?.for !== query;

  const groups = new Map<string, SearchHit[]>();
  for (const h of hits ?? []) groups.set(h.group, [...(groups.get(h.group) ?? []), h]);
  const picked = KINDS.find((k) => k.key === kind) ?? KINDS[0];
  const on = picked.key;
  const shown = [...groups].filter(([g]) => !picked.groups || picked.groups.includes(g));

  function remember(term: string) {
    const next = [term, ...recent.filter((r) => r.toLowerCase() !== term.toLowerCase())].slice(0, RECENT_MAX);
    setRecent(next);
    if (recentKey) void writeSecret(recentKey, JSON.stringify(next)).catch(() => undefined);
  }

  function open(h: SearchHit) {
    remember(h.title);
    const href = appHrefFor(h.href, currentTabs(), me?.memberRole ?? me?.role ?? null);
    router.back();
    if (href) router.push(href as never);
    else router.push({ pathname: "/computer", params: { path: h.href, title: h.title } });
  }

  const chips = <FilterChips items={KINDS.map((k) => ({ key: k.key, label: k.key }))} value={on} onChange={setKind} />;

  return (
    <View style={{ flex: 1, backgroundColor: p.canvas, paddingTop: insets.top }}>
      {IOS ? (
        <View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingTop: 6, paddingHorizontal: 16, paddingBottom: 10 }}>
            <View style={{ flex: 1 }}><SearchBox testID="search-input" value={q} onChangeText={setQ} placeholder="Search" autoFocus /></View>
            <Pressable testID="search-cancel" accessibilityRole="button" onPress={() => router.back()} hitSlop={8}><Text style={{ fontFamily: F.r, fontSize: 17, color: p.greenInk }}>Cancel</Text></Pressable>
          </View>
          {chips}
        </View>
      ) : (
        <View>
          <View style={{ height: 64, flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, marginBottom: 6 }}>
            <IconButton icon="arrowL" label="Back" onPress={() => router.back()} color={p.ink} round />
            <TextInput testID="search-input" value={q} onChangeText={setQ} placeholder="Search" placeholderTextColor={p.muted} autoFocus returnKeyType="search" autoCapitalize="none" autoCorrect={false} accessibilityLabel="Search"
              style={{ flex: 1, height: 48, fontFamily: F.r, fontSize: 18, color: p.ink, paddingVertical: 0 }} />
            {q ? <IconButton icon="x" label="Clear" onPress={() => setQ("")} color={p.muted} round /> : <View style={{ width: 48 }} />}
          </View>
          {chips}
          <View style={{ height: 1, backgroundColor: p.line, marginTop: chips ? 10 : 0 }} />
        </View>
      )}
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}>
        {busy && !hits ? <Loading rows={4} /> : hits === null ? (recent.length ? null : <Empty icon="search" title="Type two letters or more" body="Names, phone numbers, policy numbers and pages." />) : shown.length ? (
          shown.map(([group, items]) => (
            <Group key={group} title={group}>
              {items.map((h, i) => {
                const look = h.group === "Policies" ? policyLook(h) : { title: h.title, meta: h.meta, status: null };
                return <Row key={`${h.href}-${i}`} first={i === 0} icon={GROUP_ICON[h.group] ?? "file"} iconTone="plain" title={look.title} highlight={query} meta={look.meta}
                  chip={look.status ? <Chip tone={statusTone(look.status)}>{look.status}</Chip> : undefined} onPress={() => open(h)} />;
              })}
            </Group>
          ))
        ) : <Empty title="Nothing found" body={on === "All" ? "Try a phone number or the last name." : `No ${on.toLowerCase()} match. Try All.`} />}
        {recent.length ? (
          <Group title="Recent">
            {recent.map((r, i) => <Row key={r} first={i === 0} icon="history" iconTone="plain" title={r} chevron={false} onPress={() => setQ(r)} testID={`search-recent-${i}`} />)}
          </Group>
        ) : null}
      </ScrollView>
    </View>
  );
}
