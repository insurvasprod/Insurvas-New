import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { reachable } from "@/lib/links";
import { currentTabs } from "@/lib/nav";
import { router, useLocalSearchParams } from "expo-router";

import { CallerProfile } from "@/components/inbound/profile";
import { FinishCall } from "@/components/inbound/finish";
import { onCallClock, PHASE_STEP, phaseOf, callerName, type Phase } from "@/components/inbound/model";
import { StepHead } from "@/components/inbound/parts";
import type { VerificationPanel } from "@/components/inbound/types";
import { Verification } from "@/components/inbound/verify";
import { Empty, Failed, Header, Loading, Screen, type HeaderAction } from "@/components/ui";
import { ApiError } from "@/lib/api";
import { useCounts } from "@/lib/counts";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";

/**
 * Boards C3 · Caller profile, C4 · Verification (with C5 and C4b as sheets) and C6 · Finish the call:
 * the web's call page (/app/inbound/call/[workItemId], `?phase=check|verify|finish`) on the phone, in
 * the same order. The call is the agency's telephony; the phone never dials here.
 *
 *   C3  GET /api/app/inbound/verification (the caller), /caller and /screening (the checks)
 *   C4  POST /api/app/inbound/verification per field, the moment it is tapped
 *   C4b POST /api/app/inbound/handoff { action: "offer" } (assistants)
 *   C6  POST /api/app/inbound/disposition start → answer → complete
 *   ⋯   POST /api/app/inbound/release (requeue a dropped call, or give it back)
 *
 * Step 3, the application, is the phone's own (app/application, opened from Verification's Continue);
 * Skip goes from Verification to Finish the call. A saved outcome opens Daily deal flow, as on the web
 * (Calls when the plan has no deal flow).
 */
export default function CallScreen() {
  const { workItemId, phase: asked, outcome } = useLocalSearchParams<{ workItemId: string; phase?: string; outcome?: string }>();
  const { api, me } = useSession();
  const counts = useCounts();
  const [phase, setPhase] = useState<Phase>(() => phaseOf(asked));
  const [now, setNow] = useState(() => Date.now());
  const loaded = useLoad(() => api<VerificationPanel>(`/api/app/inbound/verification?work_item_id=${encodeURIComponent(workItemId)}`), [workItemId]);
  const [fresh, setFresh] = useState<VerificationPanel | null>(null);
  const panel = fresh ?? loaded.data;
  const started = panel?.context?.callStartedAt ?? null;

  useEffect(() => {
    if (!started) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [started]);

  const assistant = me?.role === "assistant";
  const step = PHASE_STEP[phase];
  const name = panel ? callerName(panel.lead.values) : "";

  const leave = () => (router.canGoBack() ? router.back() : router.replace(reachable("/calls", currentTabs()) as never));

  async function release(action: "requeue" | "unassign") {
    try {
      await api("/api/app/inbound/release", { method: "POST", body: { action, work_item_id: workItemId } });
      counts.refresh();
      router.replace(reachable("/calls", currentTabs()) as never);
    } catch (e) {
      Alert.alert("Not changed", e instanceof ApiError ? e.message : "Try again.");
    }
  }

  // ⋯ on the call: the two real ways to let it go (POST /api/app/inbound/release).
  const more: HeaderAction = {
    icon: "moreH", label: "More", onPress: () => Alert.alert(name || "This call", undefined, [
      { text: "The call dropped · put it back in the queue", onPress: () => void release("requeue") },
      { text: "Give it back to the queue", style: "destructive", onPress: () => void release("unassign") },
      { text: "Cancel", style: "cancel" },
    ]),
  };

  const header = (
    <Header large={false}
      title={phase === "check" ? name : phase === "verify" ? "Verification" : "Finish the call"}
      back={phase === "check" ? "Calls" : phase === "verify" ? "Profile" : "Back"}
      onBack={phase === "check" ? leave : () => setPhase(phase === "verify" ? "check" : "verify")}
      actions={phase === "finish" ? [] : [more]}
      belowFull={<StepHead step={step} onCall={onCallClock(started, now)} />} />
  );

  if (!panel) {
    let body = <Loading rows={4} />;
    if (loaded.error) {
      body = loaded.errorCode?.status === 403 || loaded.errorCode?.status === 404
        ? <Empty icon="lock" title="This call isn’t open for you" body={loaded.error} />
        : <Failed message={loaded.error} onRetry={loaded.reload} />;
    }
    return <Screen header={<Header large={false} title="" back="Calls" onBack={leave} />}>{body}</Screen>;
  }

  if (phase === "check") return <CallerProfile panel={panel} workItemId={workItemId} header={header} onNext={() => setPhase("verify")} />;
  if (phase === "verify") {
    return <Verification panel={panel} onPanel={setFresh} workItemId={workItemId} header={header} canHandoff={assistant} onFinish={() => setPhase("finish")} />;
  }
  const dealFlow = !me?.plan?.features || me.plan.features.includes("daily_deal_flow");
  return <FinishCall workItemId={workItemId} header={header} canFinish={!assistant} preset={typeof outcome === "string" ? outcome : null}
    onSaved={() => { counts.refresh(); router.replace((dealFlow ? "/deal-flow" : reachable("/calls", currentTabs())) as never); }} />;
}
