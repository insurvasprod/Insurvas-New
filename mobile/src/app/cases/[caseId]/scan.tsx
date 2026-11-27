import { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import { sendPages, takePage, type Page } from "@/components/cases/capture";
import { KIND_SHORT, KIND_TITLE, latestSubmission, openRequirements, type CaseView } from "@/components/cases/model";
import { AddPage, CanvasSelect, PageThumb } from "@/components/cases/parts";
import { ChoiceSheet } from "@/components/menu/choice-sheet";
import { ActionSheet, Toast } from "@/components/leads/sheets";
import { Button, F, Failed, Field, Header, Loading, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/**
 * Board E6b · Send a scanned document: the pages in order (tap one to move, retake or remove it), the
 * requirement they answer, a note for underwriting, then one send. The first page arrives from the case
 * screen's camera. Data: GET /api/app/applications/cases/:id for the attempt's open requirements; the
 * pages go one by one to the requirement's documents route (capture.ts), and the last one hands the
 * requirement back to the carrier ("Sent" on the case). A page already sent is never sent again on a retry.
 */
const short = (title: string) => title.replace(/\s*\(.*\)$/, "");

export default function SendScan() {
  const p = usePalette();
  const { api, refreshToken } = useSession();
  const params = useLocalSearchParams<{ caseId: string; attempt: string; requirement: string; page?: string; name?: string; type?: string }>();
  const [pages, setPages] = useState<Page[]>(() => (params.page ? [{ uri: params.page, name: params.name ?? "page-1.jpg", type: params.type ?? "image/jpeg" }] : []));
  const [target, setTarget] = useState(params.requirement);
  const [note, setNote] = useState("");
  const [picking, setPicking] = useState(false);
  const [pageMenu, setPageMenu] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  /** Pages the server already holds from an earlier try; reset when the pages change. */
  const [sent, setSent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const load = useLoad(() => api<CaseView>(`/api/app/applications/cases/${params.caseId}`), [params.caseId]);

  const attempt = load.data?.attempts.find((a) => a.id === params.attempt) ?? null;
  const open = attempt ? openRequirements(attempt) : [];
  const req = open.find((r) => r.id === target) ?? null;
  const carrier = attempt?.carrierName ?? "the carrier";
  const reference = attempt ? latestSubmission(attempt)?.carrierReference : null;
  const sendTo = (id: string) => {
    const r = open.find((x) => x.id === id);
    return [carrier, r ? `requirement ${KIND_SHORT[r.kind]}` : null, reference].filter(Boolean).join(" · ");
  };

  const capture = async (replace?: number) => {
    try {
      const page = await takePage(replace != null ? replace + 1 : pages.length + 1);
      if (!page) return;
      setPages((now) => (replace != null ? now.map((x, i) => (i === replace ? page : x)) : [...now, page]));
      setSent(0);
    } catch (e) {
      setToast(e instanceof Error ? e.message : "The camera didn’t open.");
    }
  };
  const move = (from: number, to: number) => { setSent(0); setPages((now) => {
    if (to < 0 || to >= now.length) return now;
    const next = [...now];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    return next;
  }); };

  const send = async () => {
    if (!attempt || !req || !pages.length) return;
    setBusy(true);
    setError(null);
    try {
      const token = await refreshToken();
      if (!token) throw new Error("Sign in again to send.");
      await sendPages({ token, attemptId: attempt.id, requirementId: req.id, pages, note, from: sent, onSent: setSent });
      router.back();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The pages didn’t send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const title = req ? short(KIND_TITLE[req.kind]) : "Scanned pages";
  const header = <Header title={title} back="Case" onBack={() => router.back()} large={false} />;
  const count = pages.length === 1 ? "1 page" : `${pages.length} pages`;
  const footer = attempt ? (
    <>
      {error ? <Text accessibilityLiveRegion="polite" style={{ fontFamily: F.r, fontSize: 13.5, lineHeight: 19, color: p.bad }}>{error}</Text> : null}
      <Button write testID="send-pages" kind="primary" icon="send" label={`Send ${count} to ${carrier}`} busy={busy} disabled={!pages.length || !req} onPress={() => void send()} />
    </>
  ) : undefined;

  let body;
  if (!load.data && load.loading) body = <Loading rows={3} />;
  else if (!load.data) body = <Failed what="this case" message={load.error ?? "Something went wrong."} onRetry={load.reload} />;
  else if (!attempt || !open.length) body = <Failed what="the requirement" message="This requirement is closed or no longer on the case." onRetry={load.reload} />;
  else {
    body = (
      <View style={{ paddingTop: 8, gap: 14 }}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}>
          {pages.map((pg, i) => <PageThumb key={`${pg.uri}-${i}`} uri={pg.uri} n={i + 1} onPress={() => setPageMenu(i)} />)}
          <AddPage onPress={() => void capture()} />
        </ScrollView>
        <View style={{ paddingHorizontal: 16, gap: 14 }}>
          <CanvasSelect testID="send-to" label="Send to" value={req ? sendTo(req.id) : "Choose a requirement"} onPress={() => setPicking(true)} />
          <Field testID="scan-note" label="Note for underwriting" value={note} onChangeText={setNote} placeholder="What these pages are" maxLength={2000} />
        </View>
      </View>
    );
  }

  return (
    <>
      <Screen header={header} footer={footer}>{body}</Screen>
      <ChoiceSheet visible={picking} title="Send to" options={open.map((r) => ({ key: r.id, label: sendTo(r.id) }))} selected={target ? [target] : []}
        onPick={(k) => setTarget(k)} onClose={() => setPicking(false)} />
      <ActionSheet visible={pageMenu != null} title={pageMenu != null ? `Page ${pageMenu + 1}` : ""} onClose={() => setPageMenu(null)} actions={pageMenu == null ? [] : [
        ...(pageMenu > 0 ? [{ key: "earlier", label: "Move earlier", icon: "arrowL" as const, onPress: () => move(pageMenu, pageMenu - 1) }] : []),
        ...(pageMenu < pages.length - 1 ? [{ key: "later", label: "Move later", icon: "chevR" as const, onPress: () => move(pageMenu, pageMenu + 1) }] : []),
        { key: "retake", label: "Retake", icon: "camera", onPress: () => void capture(pageMenu) },
        { key: "remove", label: "Remove", icon: "x", destructive: true, onPress: () => { setSent(0); setPages((now) => now.filter((_, i) => i !== pageMenu)); } },
      ]} />
      <Toast text={toast} onHide={() => setToast(null)} />
    </>
  );
}
