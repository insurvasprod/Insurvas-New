import { useState, type ReactNode } from "react";
import { View } from "react-native";
import { router } from "expo-router";

import { ToneGroup } from "@/components/calls/parts";
import { ActionSheet } from "@/components/leads/sheets";
import { Chip, Empty, Failed, Header, Loading, Row, Screen, SearchBox, SectionHead, Strip, Tile, type HeaderAction } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { NewCaseSheet } from "./new-case-sheet";
import { openRetention } from "./nav";
import { clockTime } from "./home-logic";
import { BOARD_GROUP_TITLE, STEP_LABEL, boardGroups, caseChip, caseName, caseWhy, casesOn, dayMonth, localDay, stepCounts, urgencyOf } from "./logic";
import type { CaseItem, CasesAnswer, Step } from "./types";

/** The subtitle's tail, as drawn: " · last file 6:02 am" when the newest carrier file came today, else its day. */
export function lastFileWords(lastFileAt: string | null | undefined, lastFileDate: string | null | undefined, now: Date): string {
  if (lastFileAt) {
    const at = new Date(lastFileAt);
    if (!Number.isNaN(at.getTime())) return ` · last file ${localDay(at) === localDay(now) ? clockTime(at) : dayMonth(localDay(at))}`;
  }
  return lastFileDate ? ` · last file ${dayMonth(lastFileDate)}` : "";
}

/**
 * Board F3 · Retention cases (GET /api/app/retention/cases): the ladder from the carrier files, never a
 * prediction. Counts a step on top (a tile picks that step), then the cases grouped by how soon they are lost,
 * past the carrier's date first. Search looks across every step. The filters button holds the other Retention
 * views: a new case (F3d), Waiting on the carrier (F3b) and, for the owner and producers, Win-back (F3c).
 *
 * `back`: the label of the screen behind ("" for none: it is opened from several places), when Cases is opened from
 * another screen rather than as a tab.
 */
export function CasesScreen({ back }: { back?: string } = {}) {
  const p = usePalette();
  const { api, me } = useSession();
  // Win-back is the owner's and a producer's (GET /api/app/retention/winback refuses everyone else), on a plan that has
  // it: a retention rep is not offered it, as the server would refuse.
  const features = me?.plan?.features;
  const winback = (me?.role === "owner" || me?.role === "producer") && (!features || features.includes("winback"));
  const load = useLoad(() => api<CasesAnswer & { lastFileAt?: string | null }>("/api/app/retention/cases"), []);
  const [step, setStep] = useState<Step | null>(null);
  const [searching, setSearching] = useState(false);
  const [needle, setNeedle] = useState("");
  const [menu, setMenu] = useState(false);
  const [creating, setCreating] = useState(false);
  const data = load.data?.available ? load.data : null;

  const actions: HeaderAction[] = [
    { icon: "search", label: "Search cases", onPress: () => { setSearching((s) => !s); setNeedle(""); } },
    { icon: "sliders", label: "Views", onPress: () => setMenu(true) },
  ];
  const sub = `From carrier files${data ? lastFileWords(data.lastFileAt, data.lastFileDate, new Date()) : ""}`;
  const header = (
    <Header title="Cases" sub={sub} actions={actions} back={back || undefined} onBack={back !== undefined ? () => router.back() : undefined} large
      below={searching ? <SearchBox testID="cases-search" value={needle} onChangeText={setNeedle} placeholder="Name, policy or carrier" autoFocus /> : undefined} />
  );

  let body;
  if (!load.data) {
    body = load.loading ? <Loading /> : <Failed what="the cases" message={load.error ?? "Try again."} onRetry={load.reload} />;
  } else if (!data) {
    body = <Empty icon="buoy" title="Not switched on yet" body={load.data.available ? undefined : load.data.message} />;
  } else {
    const counts = stepCounts(data.cases);
    const shown = casesOn(data.cases, step, needle);
    const tile = (s: Step, value: number, detail: ReactNode) => (
      <Tile key={s} testID={`cases-tile-${s}`} width={150} label={STEP_LABEL[s]} value={String(value)} detail={detail} onPress={() => setStep((cur) => (cur === s ? null : s))} />
    );
    body = (
      <>
        {!needle ? (
          <Strip>
            {tile("payment_problem", counts.payment_problem, "Save before pending lapse")}
            {/* The warning chip only says something when a case is lost this week; never a "0 this week" chip. */}
            {tile("pending_lapse", counts.pending_lapse, counts.pendingThisWeek ? <Chip tone="warn">{`${counts.pendingThisWeek} this week`}</Chip> : "None lost this week")}
            {tile("lapsed_reinstatable", counts.lapsed_reinstatable, "Win back with one payment")}
            {tile("paperwork", counts.paperwork, "Address, bank, beneficiary")}
          </Strip>
        ) : null}
        {step && !needle ? <SectionHead link="All cases" onLink={() => setStep(null)}>{`${STEP_LABEL[step]} · ${shown.length}`}</SectionHead> : null}
        {!shown.length ? (
          <Empty icon="buoy" title={needle ? "No case matches" : "Nothing to work here"} body={needle ? `No open case matches “${needle.trim()}”.` : "A case opens when a carrier file flags a policy you work."} />
        ) : step === "paperwork" && !needle ? (
          <ToneGroup title={`Paperwork · ${shown.length}`}>{shown.map((c, i) => <CaseRow key={c.id} c={c} first={i === 0} />)}</ToneGroup>
        ) : (
          boardGroups(shown).map((g) => (
            <ToneGroup key={g.key} title={`${BOARD_GROUP_TITLE[g.key]} · ${g.cases.length}`} color={g.key === "week" ? p.warn : undefined}>
              {g.cases.map((c, i) => <CaseRow key={c.id} c={c} first={i === 0} />)}
            </ToneGroup>
          ))
        )}
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <Screen header={header} onRefresh={load.refresh} refreshing={load.refreshing}>{body}</Screen>
      <ActionSheet visible={menu} title="Retention" onClose={() => setMenu(false)} actions={[
        { key: "new", label: "New case", icon: "plus", onPress: () => setCreating(true) },
        { key: "waiting", label: "Waiting on the carrier", icon: "wrench", onPress: () => openRetention("/retention/waiting") },
        ...(winback ? [{ key: "winback", label: "Win-back", icon: "heart" as const, onPress: () => openRetention("/retention/win-back") }] : []),
      ]} />
      {creating ? <NewCaseSheet visible onClose={() => setCreating(false)} onOpened={(id) => { setCreating(false); load.reload(); openRetention(`/retention/${id}`); }} /> : null}
    </View>
  );
}

/** A case row (F3): the buoy, warm when it is lost this week; the carrier and the reason; the one chip. */
export function CaseRow({ c, first, meta }: { c: CaseItem; first?: boolean; meta?: string }) {
  const chip = caseChip(c);
  const u = urgencyOf(c);
  return (
    <Row first={first} icon="buoy" iconTone={u === "over" ? "bad" : u === "week" ? "warn" : "brand"} title={caseName(c)} meta={meta ?? `${c.carrierName} · ${caseWhy(c)}`}
      chip={<Chip tone={chip.tone}>{chip.text}</Chip>} onPress={() => openRetention(`/retention/${c.id}`)} testID={`case-row-${c.id}`} />
  );
}
