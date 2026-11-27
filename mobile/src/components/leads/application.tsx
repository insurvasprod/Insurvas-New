import { Alert, Text, View } from "react-native";
import { router } from "expo-router";

import { CardTitle } from "@/components/leads/parts";
import { Button, Card, Empty, F, Loading } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

/** start_outbound_application wants the work item held by this agent in one of these states. */
const STARTABLE = new Set(["claimed", "buffer_active", "la_active"]);
export type EntryWorkItem = { id: string; status: string; owner_user_id: string | null; disposition?: string | null };

/** Why Start can't go ahead, in the web's words (lead-application-entry.tsx), or null when it can. */
export function whyNotStart(item: EntryWorkItem | null, currentUserId: string): string | null {
  if (!item) return "This lead has no work item, so an application can't start here.";
  if (STARTABLE.has(item.status) && item.owner_user_id === currentUserId) return null;
  if (item.status === "unclaimed") return "Claim this lead to start an application.";
  if (STARTABLE.has(item.status)) return "Someone else is working this lead; they start its application.";
  if (item.disposition === "callback_scheduled") return "A callback is booked. When it comes due the lead is back in the queue; claim it then to start the application.";
  return "This lead's work is closed, so an application can't start here.";
}
/** Who may start one on the web (lead-application-entry.tsx): an owner or producer, on a writable workspace. */
const NOT_YOURS = "An owner or producer starts the application for this lead.";

type Props = { leadId: string; workItem: EntryWorkItem | null; currentUserId: string; canStart: boolean };

/**
 * The lead page's door into applications (board D3's "Start application" under What happens next),
 * the web's LeadApplicationEntry on the phone: Open application when the lead has one (it opens on
 * the phone, board E2, at the step where it stopped), else Start application, always shown (board
 * D3): when the agent holds the work item it goes to board E1b (the product, then POST
 * /api/app/applications/start); otherwise the tap says why it can't start yet, in the web's words.
 * Nothing for a tenant or role without Applications (the lookup answers 403).
 */
export function ApplicationEntry({ leadId, workItem, currentUserId, canStart }: Props) {
  const { api } = useSession();
  const found = useLoad(() => api<{ caseId: string | null }>(`/api/app/applications/for-lead/${leadId}`), [leadId]);

  if (!found.data) return null;
  return <View style={{ marginTop: 12 }}><EntryButton caseId={found.data.caseId} leadId={leadId} workItem={workItem} currentUserId={currentUserId} canStart={canStart} /></View>;
}

function EntryButton({ caseId, leadId, workItem, currentUserId, canStart }: Props & { caseId: string | null }) {
  if (caseId) {
    return <Button testID="lead-open-application" label="Open application" kind="tonal" icon="filePen" onPress={() => router.push({ pathname: "/application/[caseId]", params: { caseId } })} />;
  }
  const blocked = canStart ? whyNotStart(workItem, currentUserId) : NOT_YOURS;
  return (
    <Button write testID="lead-start-application" label="Start application" kind="tonal" icon="filePen"
      onPress={() => (blocked ? Alert.alert("Start application", blocked) : router.push({ pathname: "/application/start", params: { leadId } }))} />
  );
}

/**
 * Board D3's sixth tab, Application: the lead's application, or the way to start one. The
 * application itself is worked on its own screens (/application/…, board E0–E4); this tab links
 * into them and never edits it here.
 */
export function ApplicationTab(props: Props) {
  const p = usePalette();
  const { api } = useSession();
  const found = useLoad(() => api<{ caseId: string | null }>(`/api/app/applications/for-lead/${props.leadId}`), [props.leadId]);
  if (found.loading && !found.data) return <Loading rows={2} />;
  if (!found.data) {
    return <Empty icon="filePen" title="Applications aren’t open here" body={found.errorCode?.status === 403 ? "Your plan or role doesn’t include applications." : found.error ?? undefined} />;
  }
  const caseId = found.data.caseId;
  return (
    <View testID="lead-application" style={{ paddingHorizontal: 16, marginTop: 14 }}>
      <Card>
        <CardTitle>{caseId ? "Application in progress" : "No application yet"}</CardTitle>
        <Text style={{ marginTop: 6, fontFamily: F.r, fontSize: 14, lineHeight: 19, color: p.muted }}>
          {caseId ? "It opens at the step where it stopped." : "Pick the product, then the questions follow on the phone."}
        </Text>
        <View style={{ marginTop: 12 }}><EntryButton caseId={caseId} {...props} /></View>
      </Card>
    </View>
  );
}
