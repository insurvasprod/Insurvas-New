import { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { boardLanes, cardLine, durationSince, initials } from "@/components/leads/logic";
import type { BoardLead } from "@/components/leads/types";
import { Avatar, F } from "@/components/ui";
import { leadName } from "@/lib/format";
import { usePalette } from "@/theme/use-palette";

const LANE = 290;
const GAP = 10;
const PAGE = 20;

/**
 * Board D2 · Leads, board. The partner-pipeline look on a phone: one lane per stage of the pipeline,
 * swiped sideways a lane at a time, the stage colour only in the lane head. Cards come from the same
 * pages GET /api/app/leads sends the list. A lane's count is the server's exact stage total
 * (`totals`, page 0's stageTotals) when nothing narrows the board, else exact once every page is in,
 * else how many are loaded ("40+"). Each card says what comes next (the last outcome, the quote, the
 * soonest callback). "Show N more" opens the lane's next cards, loading the next page when the lane
 * has shown all it has. Long-press a card to move it (straight to D6; the move is an outcome).
 */
export function Board({ stages, leads, complete, onOpen, onMove, hasMore, onLoadMore, totals }: {
  stages: { id: string; name: string }[]; leads: BoardLead[]; complete: boolean;
  onOpen: (lead: BoardLead) => void; onMove?: (lead: BoardLead) => void; hasMore: boolean; onLoadMore: () => void;
  /** Exact leads per stage, or null when a filter, Mine or a search narrows what the lanes hold. */
  totals?: Record<string, number | null> | null;
}) {
  const p = usePalette();
  const [at, setAt] = useState(0);
  const [shown, setShown] = useState<Record<string, number>>({});
  const lanes = boardLanes(stages, leads);
  /** When the board opened: "time in stage" is measured against it. */
  const [now] = useState(() => Date.now());

  return (
    <View testID="leads-board">
      <ScrollView horizontal showsHorizontalScrollIndicator={false} decelerationRate="fast" snapToInterval={LANE + GAP} snapToAlignment="start"
        contentContainerStyle={{ gap: GAP, paddingTop: 4, paddingHorizontal: 16 }}
        onScroll={(e) => setAt(Math.round(e.nativeEvent.contentOffset.x / (LANE + GAP)))} scrollEventThrottle={32}>
        {lanes.map((lane) => {
          const limit = shown[lane.id] ?? PAGE;
          const exact = totals?.[lane.id] ?? null;
          const count = exact ?? lane.leads.length;
          const more = Math.max(0, count - Math.min(limit, lane.leads.length));
          const canShow = lane.leads.length > limit || (hasMore && (exact === null || more > 0));
          return (
            <View key={lane.id} testID={`lane-${lane.id}`} style={{ width: LANE, backgroundColor: p.surf2, borderRadius: 14, padding: 10, gap: 8 }}>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingTop: 2, paddingHorizontal: 4, paddingBottom: 4 }}>
                <Text numberOfLines={1} style={{ flex: 1, fontFamily: F.s, fontSize: 15, color: p.ink }}>{lane.name}</Text>
                <Text style={{ fontFamily: F.m, fontSize: 13, color: p.muted, fontVariant: ["tabular-nums"] }}>{`${count.toLocaleString()}${exact !== null || complete ? "" : "+"}`}</Text>
              </View>
              <View style={{ height: 3, borderRadius: 2, backgroundColor: p.green, opacity: 0.6, marginTop: -2, marginHorizontal: 4, marginBottom: 2 }} />
              {lane.leads.slice(0, limit).map((lead) => {
                const since = durationSince(lead.stage_entered_at, now);
                const line = cardLine(lead, now);
                return (
                  <Pressable key={lead.id} testID={`card-${lead.id}`} accessibilityRole="button" accessibilityLabel={leadName(lead.values)} accessibilityHint={onMove ? "Long-press to move it to another stage" : undefined}
                    onPress={() => onOpen(lead)} onLongPress={onMove ? () => onMove(lead) : undefined} delayLongPress={350}
                    style={({ pressed }) => ({ backgroundColor: pressed ? p.surf2 : p.surf, borderWidth: 1, borderColor: p.line, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 })}>
                    <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 15, color: p.ink }}>{leadName(lead.values)}</Text>
                    {line ? <Text numberOfLines={1} style={{ fontFamily: F.r, fontSize: 13, color: p.muted, marginTop: 2 }}>{line}</Text> : null}
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8, minHeight: 26 }}>
                      <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{since ? `${since} in stage` : ""}</Text>
                      {lead.owner_name ? <Avatar initials={initials(lead.owner_name)} size={26} /> : null}
                    </View>
                  </Pressable>
                );
              })}
              {canShow ? (
                <Pressable testID={`lane-more-${lane.id}`} accessibilityRole="button" style={{ padding: 6, alignItems: "center" }}
                  onPress={() => { setShown((s) => ({ ...s, [lane.id]: limit + PAGE })); if (lane.leads.length <= limit + PAGE && hasMore) onLoadMore(); }}>
                  <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{more > 0 ? `Show ${more.toLocaleString()} more` : "Show more"}</Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
      {lanes.length > 1 ? (
        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6, marginTop: 12 }}>
          {lanes.map((lane, i) => <View key={lane.id} style={{ width: i === at ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === at ? p.green : p.line2 }} />)}
        </View>
      ) : null}
    </View>
  );
}
