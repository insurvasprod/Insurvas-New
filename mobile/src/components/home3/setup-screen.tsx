import { Platform, View } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";

import { Icon } from "@/components/icon";
import { Empty, Failed, Group, Header, IOS, Loading, Row, Screen } from "@/components/ui";
import { useSession } from "@/lib/session";
import { useLoad } from "@/lib/use-load";
import { usePalette } from "@/theme/use-palette";

import { Progress, openWeb } from "./parts";
import { inviteMeta, setupRows, type PhoneSetupAnswer, type SetupRow } from "./setup-logic";

/**
 * Board B9 · Get set up on the owner's phone: the web's guided setup (GET /api/app/setup?phone=1, the same steps, done
 * marks and order as /app/setup). As drawn: the progress bar and "5 of 9 done", Done (each step ticked), then Next:
 * the steps a phone does well first (Invite your team, gold, with the plan's room; Add your licences, the badge),
 * then the ones that carry the laptop mark and send their link to the computer. The count is what the board draws:
 * the steps that make you ready, this phone's alerts and the licences. Optional steps are not drawn.
 */
export function SetupScreen() {
  const { api } = useSession();
  const setup = useLoad(() => api<PhoneSetupAnswer>("/api/app/setup?phone=1"), []);
  // The web preview has no notifications; a phone answers from its own settings.
  const alerts = useLoad(async () => (Platform.OS === "web" ? null : (await Notifications.getPermissionsAsync()).granted), []);
  // null: not known (the web preview, or still asking the phone), so the alerts row is neither drawn nor counted.
  const alertsOn = alerts.loading ? null : alerts.data;
  const rows = setup.data ? setupRows(setup.data.checklist.steps, alertsOn, setup.data.phone) : null;

  let body;
  if (!setup.data || !rows) body = setup.loading ? <Loading rows={6} /> : <Failed what="your setup" message={setup.error ?? "Try again."} onRetry={setup.reload} />;
  else if (!rows.total) body = <Empty icon="check" title="Nothing to set up" body="Your plan has no setup steps for your role." />;
  else {
    const seatsLeft = setup.data.phone?.seatsLeft;
    body = (
      <>
        <View style={{ paddingHorizontal: 16, paddingTop: 4 }}><Progress share={rows.share} label={rows.label} /></View>
        {rows.done.length ? (
          <Group title="Done">
            {rows.done.map((s, i) => <Row key={s.key} first={i === 0} icon="checkC" iconTone="plain" title={s.label} chevron={false} />)}
          </Group>
        ) : null}
        {rows.next.length ? (
          <Group title="Next">
            {rows.next.map((r, i) => <NextRow key={r.kind === "step" ? r.step.key : r.kind} row={r} first={i === 0} seatsLeft={seatsLeft} />)}
          </Group>
        ) : null}
      </>
    );
  }

  return (
    <Screen header={<Header back={IOS ? "Home" : undefined} onBack={router.back} large title="Get set up" sub={rows?.total ? rows.label : undefined} />} onRefresh={setup.refresh} refreshing={setup.refreshing}>
      {body}
    </Screen>
  );
}

/** A step still to do: on the phone (opens here) or on the computer (the laptop mark, the link sent there). */
function NextRow({ row, first, seatsLeft }: { row: SetupRow; first: boolean; seatsLeft: number | null | undefined }) {
  const p = usePalette();
  if (row.kind === "alerts") return <Row first={first} testID="setup-alerts" icon="bell" iconTone="gold" title="Turn on alerts" meta="On this phone · takes a minute" onPress={() => router.push("/notifications")} />;
  if (row.kind === "licences") return <Row first={first} testID="setup-licences" icon="badge" title="Add your licences" meta="Photo of each licence works" onPress={() => router.push("/compliance/licences")} />;
  const { step } = row;
  // Invite your team: the Team tab, where the invite starts (lib/links maps the web's invite page there).
  if (row.here) return <Row first={first} testID={`setup-${step.key}`} icon="userPlus" iconTone="gold" title={step.label} meta={step.skipped ? "Skipped" : inviteMeta(seatsLeft)} onPress={() => openWeb("/app/producers/invite", step.label)} />;
  return (
    <Row first={first} testID={`setup-${step.key}`} icon="laptop" iconTone="plain" title={step.label} meta={step.skipped ? "Skipped" : null} chevron={false}
      chip={<View accessibilityLabel="Opens on a computer"><Icon name="laptop" size={18} color={p.faint} /></View>}
      onPress={() => openWeb(step.path.startsWith("/app/") ? step.path : "/app/setup", step.label)} />
  );
}
