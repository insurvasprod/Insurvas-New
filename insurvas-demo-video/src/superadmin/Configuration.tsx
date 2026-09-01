import React from "react";
import { useCurrentFrame } from "remotion";
import { AdminBrowser, Backdrop, Badge, Callout, Kicker, Panel, Progress, Tiny, c, appear, bounce } from "./shared";

const configuration = [
  ["Payments", "Providers, modes, keys, health", "blue"],
  ["Offers & discounts", "Promotions and automatic rules", "orange"],
  ["Products", "Shared platform catalog", "purple"],
  ["Templates", "Fields, pipelines, application forms", "blue"],
  ["Compliance sources", "TCPA and Do Not Call vendors", "green"],
  ["Credits & limits", "Packs, meters, usage limits", "orange"],
  ["Features", "Catalog and kill switches", "purple"],
  ["Email", "Sender, server, message templates", "blue"],
  ["System", "Maintenance and announcements", "red"],
  ["Advanced", "Raw platform settings", "green"],
] as const;

export const SuperAdminConfiguration: React.FC = () => {
  const frame = useCurrentFrame();
  return <Backdrop light><Progress step={7} total={9} /><div style={{ position: "absolute", left: 66, top: 66, ...appear(frame, 5) }}><Kicker light>07 · Configuration center</Kicker><div style={{ marginTop: 10, fontSize: 33, fontWeight: 800, color: c.navy }}>Configure the services behind the platform.</div></div><div style={{ position: "absolute", left: 105, top: 164, ...appear(frame, 14) }}><AdminBrowser active="Configuration Center" light><div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}><div><div style={{ color: c.navy, fontSize: 23, fontWeight: 800 }}>Configuration Center</div><Tiny>Platform-wide settings grouped by what they affect.</Tiny></div><Badge tone="green">Changes audited</Badge></div><div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 9, marginTop: 19 }}>{configuration.map(([name, description, tone], i) => <Panel key={name} style={{ padding: 12, borderColor: i === 0 && frame > 45 ? c.blue : c.line, boxShadow: i === 0 && frame > 45 ? "0 0 0 3px rgba(0,112,204,.08)" : "none" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={{ color: c.ink, fontSize: 12, fontWeight: 800 }}>{name}</div><Badge tone={tone}>{i === 8 ? "Attention" : "Ready"}</Badge></div><div style={{ marginTop: 5, color: c.muted, fontSize: 10 }}>{description}</div></Panel>)}</div><div style={{ marginTop: 13, padding: "11px 13px", borderRadius: 8, background: "#f0f7fd", display: "flex", justifyContent: "space-between", alignItems: "center" }}><Tiny>Recent change: payment provider health check</Tiny><span style={{ color: c.blue, fontSize: 10, fontWeight: 800 }}>View audit log →</span></div></AdminBrowser><Callout title="Every service has a home" body="Payments, catalog, templates, compliance, usage, email, features, and system controls stay discoverable and accountable." top={194} right={-249} /><div style={{ position: "absolute", top: 432, right: -249, ...bounce(frame, 104), color: c.green, fontSize: 17, fontWeight: 800 }}>✓ Settings are grouped by impact</div></div><div style={{ position: "absolute", right: 66, bottom: 25, color: c.muted, fontSize: 10, letterSpacing: 1.2 }}>PAYMENTS · COMPLIANCE · CONFIGURATION · SYSTEM</div></Backdrop>;
};
