import { useState } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { CallSheet } from "@/components/call-sheet";
import { Chip, Empty, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

import { caseName, winbackChip, winbackMeta, winbackOrder, winbackStage } from "./logic";
import type { WinbackAnswer } from "./types";

/**
 * Board F3c · Win-back (GET /api/app/retention/winback): former clients past reinstatement, ready to call once
 * the cooling-off for why they left has passed. A ready one is a lead on the agency's Win-back list, so the call
 * is that lead's call sheet, through every dialer check (never a bare tel: link). Stuck and still-cooling ones
 * show why and when, and open nothing.
 *
 * Owners and producers only, as on the web: a retention rep has no win-back calls (LA-5.8), so the server
 * answers them 403 and this says so.
 */
export function WinbackScreen() {
  const { api } = useSession();
  const load = useLoad(() => api<WinbackAnswer>("/api/app/retention/winback"), []);
  const [calling, setCalling] = useState<string | null>(null);
  const header = (sub?: string) => <Header title="Win-back" sub={sub} back={IOS ? "Cases" : undefined} onBack={() => router.back()} large />;

  if (!load.data) {
    return (
      <Screen header={header()}>
        {load.loading ? <Loading /> : load.errorCode?.status === 403
          ? <Empty icon="heart" title="Win-back isn’t part of your role" body="Owners and producers call former clients back. Your cases are on the ladder." />
          : <Failed what="win-back" message={load.error ?? "Try again."} onRetry={load.reload} />}
      </Screen>
    );
  }
  if (!load.data.available) return <Screen header={header()}><Empty icon="heart" title="Not switched on yet" body={load.data.message} /></Screen>;

  const today = load.data.today;
  const people = winbackOrder(load.data.people, today);
  const past = people.filter((r) => ["released", "blocked"].includes(winbackStage(r, today))).length;
  return (
    <View style={{ flex: 1 }}>
      <Screen header={header(`Cooling-off passed · ${past} ${past === 1 ? "person" : "people"}`)} onRefresh={load.refresh} refreshing={load.refreshing}>
        {people.length ? (
          <Group>
            {people.map((r, i) => {
              const chip = winbackChip(r, today);
              const ready = winbackStage(r, today) === "released" && r.leadId;
              return (
                <Row key={r.id} first={i === 0} icon="heart" title={caseName(r)} meta={winbackMeta(r)} chip={<Chip tone={chip.tone}>{chip.text}</Chip>}
                  onPress={ready ? () => setCalling(r.leadId) : undefined} testID={`winback-row-${r.id}`} />
              );
            })}
          </Group>
        ) : <Empty icon="heart" title="No former clients yet" body="A client lands here once their policy is past the carrier’s reinstatement window." />}
      </Screen>
      {calling ? <CallSheet leadId={calling} visible backLabel="Win-back" onClose={() => setCalling(null)} onSaved={load.reload} /> : null}
    </View>
  );
}
