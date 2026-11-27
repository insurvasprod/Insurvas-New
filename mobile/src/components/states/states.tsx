import type { ReactNode } from "react";
import { Text, View } from "react-native";

import { Icon, type IconName } from "@/components/icon";
import { SheenRows } from "@/components/motion/sheen";
import { BarMark, Button, Failed, F, Group, PausedBlock, PlanBlock, type HeaderAction } from "@/components/ui";
import { planModule, refusalFor } from "@/lib/api";
import { answerState } from "@/lib/answer-state";
import { offlineLabel, ownsAgency, useBarState } from "@/lib/outbox-state";
import { usePalette } from "@/theme/use-palette";

/**
 * Board section 13, drawn to the board where the shared kit's versions differ (components/ui.tsx keeps
 * its Loading / Empty / Failed and draws the bar's marks itself; these are the board's M1–M4, M6 and L4
 * for any screen to use):
 *
 *   M1 Skeleton      grouped .skrow rows: 30px tile, a 55% line, an 80% 10px line, a 56×22 pill
 *   M2 Nothing       .empty with one 220px button
 *   M3 CouldntLoad   the refresh tile in the bad tone, "We couldn’t load …", a 200px primary Try again
 *   M4 NotInPlan     the lock tile, what is missing and who can change it, no prices or buy buttons
 *   M6 Paused        the lock tile, the server's reason and who can fix it; ReadOnlyMark for the bar
 *   L4 OfflineMark   a small warn chip in the bar ("Offline · 3 to send"), never a banner
 */

/** M1 · rows that wait 180ms before showing (frame first), with the sheen while they wait. */
export function Skeleton({ rows = 6 }: { rows?: number }) {
  return <Group><SheenRows rows={rows} /></Group>;
}

/** The .empty block with the board's tile; `tone="bad"` is M3's red tile. */
function StateBlock({ icon, tone, title, body, action, top = 60, actionWidth }: { icon: IconName; tone?: "bad"; title: string; body?: ReactNode; action?: ReactNode; top?: number; actionWidth?: number }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: "center", paddingHorizontal: 30, paddingTop: top, paddingBottom: 24, gap: 10 }}>
      <View style={{ width: 64, height: 64, borderRadius: 18, backgroundColor: tone === "bad" ? p.badS : p.surf2, alignItems: "center", justifyContent: "center" }}>
        <Icon name={icon} size={30} color={tone === "bad" ? p.bad : p.greenInk} />
      </View>
      <Text accessibilityRole="header" style={{ marginTop: 6, fontFamily: F.db, fontSize: 20, lineHeight: 25, color: p.ink, textAlign: "center" }}>{title}</Text>
      {body ? <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.muted, textAlign: "center" }}>{body}</Text> : null}
      {action ? <View style={{ width: actionWidth ?? 220, marginTop: 10 }}>{action}</View> : null}
    </View>
  );
}

/** M2 · a true empty state: why, and the next useful move (never shown when the fetch failed). */
export function Nothing({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: { label: string; icon?: IconName; onPress: () => void } }) {
  return <StateBlock icon={icon} title={title} body={body} action={action ? <Button label={action.label} icon={action.icon} onPress={action.onPress} /> : undefined} />;
}

/** M3 · what failed, the server's words (or what still holds when the phone is offline), and Try again. */
export function CouldntLoad({ what, message, onRetry }: { what: string; message: string; onRetry: () => void }) {
  const offline = refusalFor(message)?.status === 0;
  const body = offline ? "The connection dropped while loading. Notes, call outcomes and answers you save here wait on this phone and send when you’re back online." : message;
  return <StateBlock icon="refresh" tone="bad" title={`We couldn’t load ${what}`} body={body} actionWidth={200} action={<Button testID="state-retry" label="Try again" icon="refresh" onPress={onRetry} />} />;
}

/** M4 · not in the plan (who can change it), or not open to this role. No prices, no buy button. */
export function NotInPlan({ thing, kind, message }: { thing: string; kind: "plan" | "role"; message?: string }) {
  const { role } = useBarState();
  if (kind === "plan") {
    const who = ownsAgency(role) ? "You can add it from Plan and billing on the web." : "Your agency owner can add it from Plan and billing on the web.";
    return <StateBlock icon="lock" title={`${thing} isn’t in your agency’s plan`} body={who} />;
  }
  return <StateBlock icon="lock" title={`${thing} isn’t open to you`} body={message} />;
}

/** M6 · the agency is paused or read-only: the server's reason and who can fix it; reading still works where it does. */
export function Paused({ message, code }: { message: string; code?: string | null }) {
  const { role } = useBarState();
  return <PausedBlock code={code ?? refusalFor(message)?.code ?? null} message={message} role={role} />;
}

/** L4 · the app got no answer: a small mark in the bar, with what waits on the phone. */
export function OfflineMark({ toSend }: { toSend?: number }) {
  const bar = useBarState();
  return <BarMark icon="wifiOff" label={offlineLabel(toSend ?? bar.toSend)} tone="warn" />;
}

/** M6 · the bar's "Read only" chip. */
export function ReadOnlyMark() {
  return <BarMark icon="lock" label="Read only" tone="neutral" />;
}

/**
 * Kept for the screens that ask for it: the kit's Header now draws Offline (L4) and Read only (M6) on every
 * screen from the session, so this adds nothing (an empty list) and never doubles the marks.
 */
export function useBarMarks(): HeaderAction[] {
  return [];
}

/**
 * One switch for a screen's load: null while there is data to show, else the board's state for the
 * answer, read from the server's code. `what` names the thing for M3 ("incoming calls"), `thing` for M4 ("Retention").
 */
export function LoadState({ loading, hasData, error, errorCode, onRetry, what, thing, rows }: {
  loading: boolean; hasData: boolean; error: string | null; errorCode: { status: number; code: string | null } | null; onRetry: () => void; what: string; thing?: string; rows?: number;
}) {
  const { role } = useBarState();
  if (hasData) return null;
  if (loading) return <Skeleton rows={rows} />;
  if (!error) return null;
  const known = refusalFor(error);
  const state = answerState(errorCode ?? known ?? { status: -1, code: null });
  if (state === "plan") {
    // The module the server named wins; a screen's own `thing` when the server named none the phone knows.
    return planModule(known?.feature) ? <PlanBlock feature={known?.feature ?? null} role={role} /> : <NotInPlan thing={thing ?? what} kind="plan" />;
  }
  if (state === "role") return <NotInPlan thing={thing ?? what} kind="role" message={error} />;
  if (state === "paused") return <Paused message={error} code={errorCode?.code ?? known?.code} />;
  return <Failed what={what} message={error} errorCode={errorCode} onRetry={onRetry} />;
}
