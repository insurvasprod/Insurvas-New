import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";

import { Toast } from "@/components/leads/sheets";
import { Button, Card, Chip, Empty, F, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { dayMonth, dayMonthYear, firstWord, slashDate } from "./format";
import type { Candidate, CandidateFacts, NeedsYouItem, NeedsYouList, PickClientItem } from "./types";

/**
 * Board F6 · Carrier sync · needs you: the decisions the carrier files leave for a person. The ones a phone settles in
 * one tap — which client is this policy (Pick the client) — are cards, one at a time; everything else (money that
 * doesn't match, a sale no carrier has, credit, agent codes) opens on the computer. The list is the web's Needs you
 * (GET /api/app/needs-you/item with no item: Agency for the owner and bookkeepers, Mine for a producer); a card reads
 * its item (GET …?kind=pick-client&id=) and decides through Policy matching, the web's own API
 * (POST /api/app/policy-matching { action: "resolve", review_id, candidate }).
 */
const saleWord = (type: string) => (type === "deal_flow" ? "sale" : "application");
const NOBODY = "none";

/** A candidate's words: its name, or what it is when the sale has no name on it. */
function candidateName(c: Candidate): string {
  return c.name && c.name !== "—" ? c.name : `${saleWord(c.type) === "sale" ? "A sale" : "An application"} of ${dayMonth(c.date)}`;
}

/**
 * The line under a candidate, as drawn: "Born 2 Jul 1961 · lead in Applied · Jordan Reyes", or for someone who already
 * holds a policy "Born 7 Feb 1961 · policy 0119990088 · Ava Kim". Without the server's facts: the sale and its day.
 */
export function candidateLine(c: Pick<Candidate, "dob" | "type" | "date">, facts?: CandidateFacts | null): string {
  const born = c.dob ? `Born ${dayMonthYear(c.dob)}` : null;
  if (facts?.policyNumber) return [born, `policy ${facts.policyNumber}`, facts.policyAgentName].filter(Boolean).join(" · ");
  if (facts?.stage) return [born, `lead in ${facts.stage}`, facts.agentName].filter(Boolean).join(" · ");
  return [born, `${saleWord(c.type)} of ${dayMonth(c.date)}`, facts?.agentName ?? null].filter(Boolean).join(" · ");
}

export function NeedsYouScreen() {
  const { api } = useSession();
  const list = useLoad(() => api<NeedsYouList>("/api/app/needs-you/item"), []);
  const data = list.data;
  // Cards decided on this visit leave the queue at once; the next read of the list agrees (decisions count against the
  // list they were made on, so a fresh read starts clean). Skipped cards go to the back of the queue.
  const [done, setDone] = useState<{ of: NeedsYouList | null; ids: string[] }>({ of: null, ids: [] });
  const [skipped, setSkipped] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const doneIds = done.of === data ? done.ids : [];
  const loaded = (data?.phone.items ?? []).filter((item) => !doneIds.includes(item.id));
  const later = loaded.filter((item) => skipped.includes(item.id)).sort((a, b) => skipped.indexOf(a.id) - skipped.indexOf(b.id));
  const queue = [...loaded.filter((item) => !skipped.includes(item.id)), ...later];
  const decided = doneIds.length;
  const current = queue[0] ?? null;
  // The true counts: the server sends the phone's cards a page at a time but counts them all.
  const total = data ? Math.max(0, data.total - decided) : 0;
  const position = decided + 1 + (current && !skipped.includes(current.id) ? later.length : 0);
  const sub = data ? `${total.toLocaleString("en-US")} ${total === 1 ? "decision" : "decisions"} from carrier files` : undefined;

  function finish(id: string, decidedIt: boolean, message: string | null) {
    if (message) setToast(message);
    if (!decidedIt) { setSkipped((s) => [...s.filter((x) => x !== id), id]); return; }
    if (!data) return;
    const ids = [...doneIds, id];
    setDone({ of: data, ids });
    // The last card of this page: read the next page when more are waiting.
    if (loaded.length <= 1 && data.phone.total - ids.length > 0) list.reload();
  }

  const header = <Header back={IOS ? "Menu" : undefined} onBack={router.back} large title="Needs you" sub={sub} />;
  return (
    <>
      <Screen header={header} onRefresh={() => { setDone({ of: null, ids: [] }); setSkipped([]); list.refresh(); }} refreshing={list.refreshing}>
        {list.loading && !data ? <Loading rows={5} />
          : list.error && !data ? (
            list.errorCode?.status === 403 ? <Empty icon="lock" title="Needs you isn’t open to you here" body={list.error} /> : <Failed what="Needs you" message={list.error} onRetry={list.reload} />
          ) : data && total === 0 ? <Empty icon="checkC" title="Nothing needs you" body="Every decision the carrier files left has been made." />
            : data ? (
              <View style={{ paddingHorizontal: 16, gap: 12 }}>
                {current ? (
                  <PickClientCard key={current.id} item={current} position={position} of={data.phone.total} readOnly={data.readOnly}
                    onDone={(decidedIt, message) => finish(current.id, decidedIt, message)} />
                ) : null}
                {data.computer.items.length ? (
                  <View style={{ marginHorizontal: IOS ? -16 : 0 }}>
                    <ComputerGroup items={data.computer.items} />
                  </View>
                ) : null}
              </View>
            ) : null}
      </Screen>
      <Toast text={toast} onHide={() => setToast(null)} />
    </>
  );
}

/** "On the computer": the decisions that need the statement or the whole list beside them. */
function ComputerGroup({ items }: { items: NeedsYouItem[] }) {
  const open = (path: string, title: string) => router.push({ pathname: "/computer", params: { path, title, why: "Money that doesn’t match needs the statement beside it; the rest needs the carrier’s row and the sales side by side." } });
  return (
    <Group title="On the computer" footer="Money that doesn’t match needs the statement beside it.">
      {items.map((item, i) => (
        <Row key={`${item.kind}:${item.id}`} testID={`needs-computer-${item.id}`} first={i === 0} icon="laptop" iconTone="plain"
          title={`${item.label} · ${item.about}`} meta={item.why} onPress={() => open(item.webPath, item.label)} />
      ))}
    </Group>
  );
}

/** One "Which client is this?" card: the carrier's row, the sales it could be, and Neither; Skip or Link. */
export function PickClientCard({ item, position, of, readOnly, onDone }: { item: NeedsYouItem; position: number; of: number; readOnly: boolean; onDone: (decided: boolean, message: string | null) => void }) {
  const p = usePalette();
  const { api } = useSession();
  const read = useLoad(() => api<PickClientItem>(`/api/app/needs-you/item?kind=pick-client&id=${encodeURIComponent(item.id)}`), [item.id]);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detail = read.data?.detail;
  // Nothing is chosen for the person unless the matcher itself calls one candidate likely.
  const likely = detail?.candidates.find((c) => c.likely);
  const choice = picked ?? (likely ? String(likely.index) : null);
  const chosen = choice !== null && choice !== NOBODY ? detail?.candidates.find((c) => String(c.index) === choice) ?? null : null;

  async function link() {
    if (!detail || choice === null) return;
    setBusy(true);
    setError(null);
    try {
      await api("/api/app/policy-matching", { method: "POST", body: { action: "resolve", review_id: detail.reviewId, candidate: chosen ? chosen.index : null } });
      onDone(true, chosen ? "Policy linked." : "Recorded: no client found.");
    } catch (e) {
      // Someone else decided it, or a newer file answered it: it leaves the queue all the same.
      if (e instanceof ApiError && (e.status === 404 || e.status === 409)) { onDone(true, e.message); return; }
      setError(e instanceof Error ? e.message : "That did not save.");
    } finally {
      setBusy(false);
    }
  }

  const row = detail?.carrierRow;
  const quote = row && detail ? `“${row.name}${row.dob ? `  DOB ${slashDate(row.dob)}` : ""}  POL ${detail.policyNumber}”` : null;
  const from = detail ? [`${detail.carrierName} policy file`, row?.fileDate ? dayMonth(row.fileDate) : null, read.data?.row ? `row ${read.data.row.rowNumber}` : null].filter(Boolean).join(" · ") : null;

  return (
    <View testID="pick-client-card"><Card>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
        <Text style={{ fontFamily: F.r, fontSize: 12.5, color: p.muted }}>{`${position} of ${of} · Which client is this?`}</Text>
        {detail ? <Chip tone="info">{`${detail.carrierName} file`}</Chip> : null}
      </View>
      {read.loading && !detail ? <View style={{ marginHorizontal: -16 }}><Loading rows={3} /></View>
        : read.error && !detail ? (
          read.errorCode?.status === 404 ? (
            <View style={{ gap: 10, marginTop: 10 }}>
              <Text style={{ fontFamily: F.r, fontSize: 15, color: p.ink }}>{read.error}</Text>
              <Button small kind="outline" label="Next" onPress={() => onDone(true, null)} />
            </View>
          ) : <View style={{ gap: 10, marginTop: 10 }}><Text style={{ fontFamily: F.r, fontSize: 15, color: p.bad }}>{read.error}</Text><Button small kind="outline" label="Try again" onPress={read.reload} /></View>
        ) : detail ? (
          <>
            <Text testID="pick-client-quote" style={{ marginTop: 8, fontFamily: F.s, fontSize: 17, lineHeight: 23, color: p.ink }}>{quote}</Text>
            {from ? <Text style={{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted }}>{from}</Text> : null}
            <View accessibilityRole="radiogroup" style={{ gap: 8, marginTop: 12 }}>
              {detail.candidates.map((c) => (
                <Option key={c.index} testID={`pick-${c.index}`} title={candidateName(c)} line={candidateLine(c, read.data?.candidateFacts?.find((f) => f.index === c.index))} on={choice === String(c.index)} onPress={() => setPicked(String(c.index))} />
              ))}
              <Option testID="pick-none" title="Neither · a sale no carrier had" line="Opens a new policy from this row" on={choice === NOBODY} onPress={() => setPicked(NOBODY)} />
            </View>
            {error ? <Text style={{ marginTop: 10, fontFamily: F.r, fontSize: 13.5, color: p.bad }}>{error}</Text> : null}
            <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
              <View style={{ flex: 1 }}><Button testID="pick-skip" small kind="outline" label="Skip" onPress={() => onDone(false, null)} style={{ alignSelf: "stretch" }} /></View>
              <View style={{ flex: 1 }}>
                <Button write testID="pick-save" small label={chosen ? `Link to ${firstWord(candidateName(chosen))}` : choice === NOBODY ? "Open a new policy" : "Pick one"}
                  disabled={choice === null || readOnly} busy={busy} onPress={() => void link()} style={{ alignSelf: "stretch" }} />
              </View>
            </View>
            {readOnly ? <Text style={{ marginTop: 8, fontFamily: F.r, fontSize: 13, color: p.muted }}>The account is read-only.</Text> : null}
          </>
        ) : null}
    </Card></View>
  );
}

/** A choice card: the board's 12×14 card, green ring and soft green fill when chosen. */
function Option({ title, line, on, onPress, testID }: { title: string; line: string; on: boolean; onPress: () => void; testID?: string }) {
  const p = usePalette();
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ checked: on }} accessibilityLabel={title} onPress={onPress}
      style={({ pressed }) => ({ paddingVertical: 12, paddingHorizontal: 14, borderRadius: 16, borderWidth: 1, borderColor: on ? p.green : p.line, backgroundColor: on ? p.greenSoft : pressed ? p.surf2 : p.surf })}>
      <Text numberOfLines={1} style={{ fontFamily: F.s, fontSize: 16, color: p.ink }}>{title}</Text>
      <Text numberOfLines={2} style={{ fontFamily: F.r, fontSize: 12.5, lineHeight: 17, color: p.muted }}>{line}</Text>
    </Pressable>
  );
}
