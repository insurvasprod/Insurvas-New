import { Text, View } from "react-native";

import { Icon } from "@/components/icon";
import { F, Failed, Loading } from "@/components/ui";
import { Mini, SheetModal } from "@/components/calls/parts";
import { deviceZone } from "@/components/calls/time";
import { phoneLabel } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";
import { complianceChecks, type Check } from "./checks";
import type { HeadPanel } from "./head-card";

/**
 * Board C7b · the body of the "Checks for (713) 555-0144" sheet: one tick per check (screens-e.js
 * `tick`: a 20px circle-check / circle-x / clock, then 15px ink and a .mini line), 12px apart, and the
 * closing line that the server runs them again at the tap.
 */
export function ChecksList({ checks }: { checks: Check[] }) {
  const p = usePalette();
  return (
    <View style={{ gap: 12, paddingBottom: 8 }} testID="checks-list">
      {checks.map((c) => (
        <View key={c.key} testID={`check-${c.key}`} accessible accessibilityLabel={`${c.title}: ${c.state === "ok" ? "passed" : c.state === "bad" ? "refused" : "not decided"}${c.detail ? `, ${c.detail}` : ""}`}
          style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
          <View style={{ marginTop: 1 }}>
            <Icon name={c.state === "ok" ? "checkC" : c.state === "bad" ? "xC" : "clock"} size={20} color={c.state === "ok" ? p.ok : c.state === "bad" ? p.bad : p.faint} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ fontFamily: F.r, fontSize: 15, lineHeight: 21, color: p.ink }}>{c.title}</Text>
            {c.detail ? <Mini>{c.detail}</Mini> : null}
          </View>
        </View>
      ))}
      <Mini>The server repeats these checks the moment you tap Call.</Mini>
    </View>
  );
}

/** C7b as its own sheet over the Calls tab: "Checks for (713) 555-0144". */
export function ChecksSheet({ panel, onClose }: { panel: HeadPanel; onClose: () => void }) {
  return (
    <SheetModal visible title={`Checks for ${phoneLabel(panel.lead.phone) ?? "this number"}`} onClose={onClose}>
      <ChecksList checks={complianceChecks(panel, new Date(), panel.viewerTimezone || deviceZone())} />
    </SheetModal>
  );
}

/** C10 → "See the checks": the refused lead's panel, read on demand. */
export function LeadChecksSheet({ leadId, onClose }: { leadId: string; onClose: () => void }) {
  const { api } = useSession();
  const loaded = useLoad(() => api<HeadPanel>(`/api/app/dialer/panel?lead_id=${leadId}`), [leadId]);
  if (loaded.data) return <ChecksSheet panel={loaded.data} onClose={onClose} />;
  return (
    <SheetModal visible title="Checks for this number" onClose={onClose}>
      {loaded.error ? <Failed message={loaded.error} onRetry={loaded.reload} /> : <Loading rows={4} />}
    </SheetModal>
  );
}
