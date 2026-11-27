import { Pressable, Text, View } from "react-native";
import { render, screen, userEvent } from "@testing-library/react-native";

import { CallsSplit, LeadsSplit, useLeadSelected, useOpenLead, useShowLead } from "@/components/native/record-split";
import { listWidth, SplitView, useSplit, WIDE_AT } from "@/components/native/split";

/**
 * Board L6 · Tablet. The window's width decides: a phone keeps one pane and a row opens the lead page;
 * a tablet keeps the list on the left and shows the lead on the right. The lead page itself is stubbed
 * here (its own tests cover it); what matters is which id it gets and that Close empties the pane.
 */
let mockWidth = 390;
jest.mock("react-native/Libraries/Utilities/useWindowDimensions", () => ({
  __esModule: true,
  default: () => ({ width: mockWidth, height: 900, scale: 2, fontScale: 1 }),
}));
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock("@/app/lead/[id]", () => {
  const { Pressable: P, Text: T, View: V } = jest.requireActual("react-native");
  return {
    LeadRecord: ({ id, onClose }: { id: string; onClose?: () => void }) => (
      <V testID="lead-record"><T>{`Lead ${id}`}</T><P accessibilityRole="button" accessibilityLabel="Close the lead" onPress={onClose}><T>Close</T></P></V>
    ),
  };
});

// The dialer's compact card reads the dialer panel; the call itself is the dialer's sheet (stubbed: its own tests).
let mockPanelFails = false;
const mockApi = jest.fn(async (path: string) => {
  if (mockPanelFails) throw new Error("Not allowed");
  if (path.startsWith("/api/app/dialer/panel")) {
    return {
      lead: { fullName: "Frank Diaz", age: "64", state: "TX", productCode: "term_life", attemptsMade: 2, attemptCeiling: null },
      consent: { hasCertificate: true, provider: "trustedform", status: "valid", capturedAt: "2026-11-20T10:00:00Z", consentTimestamp: "2026-11-20T10:00:00Z" },
      eligibility: null,
      window: { allowed: true, startMinute: 480, endMinute: 1260, zone: "America/Chicago", reason: null },
      viewerTimezone: "America/Chicago",
    };
  }
  throw new Error(`unexpected ${path}`);
});
jest.mock("@/lib/session", () => ({ useSession: () => ({ api: mockApi, me: { user: { id: "me" }, role: "producer" } }) }));
jest.mock("@/components/call-sheet", () => {
  const { Text: T } = jest.requireActual("react-native");
  return { CallSheet: ({ leadId }: { leadId: string }) => <T>{`Calling ${leadId}`}</T> };
});

const LEADS = [{ id: "l1", name: "Harold Nguyen" }, { id: "l2", name: "Linda Ortiz" }];

/** A stand-in for the Leads tab: rows that open through the hook the tab will use. */
function LeadList() {
  const open = useOpenLead();
  const selected = useLeadSelected();
  return (
    <View>
      {LEADS.map((l) => (
        <Pressable key={l.id} accessibilityRole="button" accessibilityLabel={l.name} accessibilityState={{ selected: selected(l.id) }} onPress={() => open(l.id)}>
          <Text>{l.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** A stand-in for the dialer: a row serves the lead on a phone, previews it on a tablet. */
function DialerList({ onServe }: { onServe: (id: string) => void }) {
  const show = useShowLead();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Frank Diaz" onPress={() => { if (!show("l9")) onServe("l9"); }}>
      <Text>Frank Diaz</Text>
    </Pressable>
  );
}

beforeEach(() => { mockPush.mockReset(); });

describe("SplitView", () => {
  it("is one pane on a phone: the list only, a row opens the lead page", async () => {
    mockWidth = 390;
    await render(<LeadsSplit><LeadList /></LeadsSplit>);
    expect(screen.queryByTestId("split-detail")).toBeNull();
    expect(screen.queryByTestId("split-placeholder")).toBeNull();
    await userEvent.setup().press(screen.getByRole("button", { name: "Linda Ortiz" }));
    expect(mockPush).toHaveBeenCalledWith("/lead/l2");
    expect(screen.queryByTestId("lead-record")).toBeNull();
  });

  it("is two panes on a tablet: a row shows its lead beside the list, Close empties the pane", async () => {
    mockWidth = 1024;
    await render(<LeadsSplit><LeadList /></LeadsSplit>);
    expect(screen.getByTestId("split-list")).toBeTruthy();
    expect(screen.getByText("Pick a lead")).toBeTruthy();
    const user = userEvent.setup();
    await user.press(screen.getByRole("button", { name: "Harold Nguyen" }));
    expect(mockPush).not.toHaveBeenCalled();
    expect(screen.getByText("Lead l1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Harold Nguyen" })).toBeSelected();

    await user.press(screen.getByRole("button", { name: "Linda Ortiz" }));
    expect(screen.getByText("Lead l2")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Harold Nguyen" })).not.toBeSelected();

    await user.press(screen.getByRole("button", { name: "Close the lead" }));
    expect(screen.queryByTestId("lead-record")).toBeNull();
    expect(screen.getByText("Pick a lead")).toBeTruthy();
  });

  it("splits from 720dp: an iPad mini upright is wide, a large phone upright is not", async () => {
    mockWidth = WIDE_AT;
    await render(<LeadsSplit><LeadList /></LeadsSplit>);
    expect(screen.getByTestId("split-list")).toBeTruthy();
    mockWidth = WIDE_AT - 1;
    await render(<LeadsSplit><LeadList /></LeadsSplit>);
    expect(screen.queryByTestId("split-list")).toBeNull();
  });

  it("keeps the list pane narrow, as the board draws it (about 36%), between 280 and 380", () => {
    expect(listWidth(744)).toBe(280);
    expect(listWidth(1000)).toBe(360);
    expect(listWidth(1366)).toBe(380);
  });

  it("Calls: on a phone a dialer row still serves; on a tablet it previews the lead instead", async () => {
    const serve = jest.fn();
    mockWidth = 390;
    await render(<CallsSplit><DialerList onServe={serve} /></CallsSplit>);
    await userEvent.setup().press(screen.getByRole("button", { name: "Frank Diaz" }));
    expect(serve).toHaveBeenCalledWith("l9");

    serve.mockReset();
    mockWidth = 1180;
    await render(<CallsSplit><DialerList onServe={serve} /></CallsSplit>);
    expect(screen.getByText("Pick someone to call")).toBeTruthy();
    await userEvent.setup().press(screen.getByRole("button", { name: "Frank Diaz" }));
    expect(serve).not.toHaveBeenCalled();
    // Board L6: the compact card on the right — name, "64 · TX · Term life", Consent / DNC / Window, a small Call.
    expect(await screen.findByText("64 · TX · Term life")).toBeTruthy();
    expect(screen.getAllByText("Frank Diaz")).toHaveLength(2); // the row on the left, the card on the right
    expect(screen.getByText("Consent")).toBeTruthy();
    expect(screen.getByText("Window")).toBeTruthy();
    const user = userEvent.setup();
    await user.press(screen.getByTestId("dialer-pane-call"));
    expect(screen.getByText("Calling l9")).toBeTruthy();
    await user.press(screen.getByTestId("dialer-pane-full"));
    expect(screen.getByText("Lead l9")).toBeTruthy();
  });

  it("Calls: a role the dialer panel refuses gets the lead page on the right", async () => {
    mockPanelFails = true;
    mockWidth = 1180;
    await render(<CallsSplit><DialerList onServe={jest.fn()} /></CallsSplit>);
    await userEvent.setup().press(screen.getByRole("button", { name: "Frank Diaz" }));
    expect(await screen.findByText("Lead l9")).toBeTruthy();
    mockPanelFails = false;
  });

  it("outside a SplitView the hooks behave like a phone", async () => {
    function Probe() { const s = useSplit(); return <Text>{`wide:${s.wide} selected:${s.selected}`}</Text>; }
    mockWidth = 1200;
    await render(<Probe />);
    expect(screen.getByText("wide:false selected:null")).toBeTruthy();
  });

  it("draws any record through `detail`", async () => {
    mockWidth = 900;
    function Opener() { const s = useSplit(); return <Pressable accessibilityRole="button" accessibilityLabel="Open" onPress={() => s.show("x1")}><Text>Open</Text></Pressable>; }
    await render(<SplitView detail={(id) => <Text>{`Record ${id}`}</Text>} placeholder={<Text>Nothing open</Text>}><Opener /></SplitView>);
    expect(screen.getByText("Nothing open")).toBeTruthy();
    await userEvent.setup().press(screen.getByRole("button", { name: "Open" }));
    expect(screen.getByText("Record x1")).toBeTruthy();
  });
});
