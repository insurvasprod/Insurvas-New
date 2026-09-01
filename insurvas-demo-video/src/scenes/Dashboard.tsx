import React from "react";
import { useCurrentFrame } from "remotion";
import { Background, BrowserFrame, Eyebrow, Progress, colors, enter, pop } from "./shared";

const stats = [
  ["Active leads", "128", "+12%", colors.blue],
  ["Policies in force", "64", "+8%", colors.green],
  ["Follow-ups due", "17", "Today", colors.orange],
] as const;

const nextActions = ["Review 5 new leads", "Call 3 follow-ups", "Upload carrier statement"];

export const Dashboard: React.FC = () => {
  const frame = useCurrentFrame();

  return (
    <Background light>
      <Progress step={5} />
      <div style={{ position: "absolute", left: 66, top: 73, ...enter(frame, 6) }}>
        <Eyebrow light>04 · Work in one place</Eyebrow>
        <div style={{ marginTop: 11, fontSize: 34, fontWeight: 800, color: colors.navy }}>
          The tenant workspace comes to life.
        </div>
      </div>

      <div style={{ position: "absolute", left: 125, top: 176, ...enter(frame, 14) }}>
        <BrowserFrame label="app" light>
          <div style={{ display: "flex", minHeight: 470, color: colors.text }}>
            <aside style={{ width: 174, background: colors.navy, padding: "25px 17px", color: colors.white }}>
              <div style={{ fontSize: 20, fontWeight: 900, color: "#82d2ff", marginBottom: 34 }}>Insurvas</div>
              {["Overview", "Leads", "Dialer", "Policies", "Settings"].map((item, i) => (
                <div key={item} style={{ padding: "10px 11px", borderRadius: 7, marginBottom: 5, background: i === 0 ? "rgba(115,200,255,.18)" : "transparent", color: i === 0 ? "#9addff" : "#b7c9d7", fontSize: 13, fontWeight: i === 0 ? 800 : 500 }}>
                  {item}
                </div>
              ))}
              <div style={{ position: "absolute", bottom: 23, marginLeft: 11, color: "#8199ad", fontSize: 11 }}>NORTHSTAR LIFE GROUP</div>
            </aside>

            <main style={{ flex: 1, padding: "26px 28px", background: "#fbfdff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                <div>
                  <div style={{ color: colors.muted, fontSize: 12 }}>MONDAY, AUGUST 31</div>
                  <div style={{ marginTop: 5, fontSize: 24, fontWeight: 800, color: colors.navy }}>Good morning, Amara</div>
                </div>
                <div style={{ width: 30, height: 30, borderRadius: "50%", background: "#ffd8b2", display: "grid", placeItems: "center", fontWeight: 800, color: "#8c4d27" }}>AD</div>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginTop: 25 }}>
                {stats.map(([label, value, change, color]) => (
                  <div key={label} style={{ padding: 15, background: colors.white, border: `1px solid ${colors.line}`, borderRadius: 10 }}>
                    <div style={{ color: colors.muted, fontSize: 11 }}>{label}</div>
                    <div style={{ marginTop: 8, fontSize: 28, fontWeight: 800, color: colors.navy }}>{value}</div>
                    <div style={{ marginTop: 7, color, fontSize: 11, fontWeight: 800 }}>{change}</div>
                  </div>
                ))}
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1.2fr .8fr", gap: 14, marginTop: 16 }}>
                <div style={{ padding: 16, background: colors.white, border: `1px solid ${colors.line}`, borderRadius: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: colors.navy }}>Lead activity</div>
                  <div style={{ height: 113, display: "flex", alignItems: "end", gap: 12, padding: "20px 10px 4px" }}>
                    {[38, 60, 49, 78, 68, 91, 74, 102, 87].map((height, i) => <div key={i} style={{ flex: 1, height, borderRadius: "5px 5px 2px 2px", background: i === 7 ? colors.blue : "#b8ddf7", opacity: .9 }} />)}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", color: colors.muted, fontSize: 10 }}><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span></div>
                </div>

                <div style={{ padding: 16, background: colors.white, border: `1px solid ${colors.line}`, borderRadius: 10 }}>
                  <div style={{ fontSize: 14, fontWeight: 800, color: colors.navy }}>Next actions</div>
                  {nextActions.map((item, i) => (
                    <div key={item} style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: colors.text }}>
                      <span style={{ width: 7, height: 7, borderRadius: "50%", background: i === 0 ? colors.blue : i === 1 ? colors.orange : colors.green }} />
                      {item}
                    </div>
                  ))}
                </div>
              </div>
            </main>
          </div>
        </BrowserFrame>

        <div style={{ position: "absolute", top: 90, left: 210, ...pop(frame, 60), padding: "10px 14px", borderRadius: 9, background: colors.greenSoft, border: "1px solid #bdebd2", color: colors.green, fontSize: 14, fontWeight: 800 }}>
          Plan active · Workspace unlocked
        </div>
      </div>
      <div style={{ position: "absolute", right: 70, bottom: 37, ...enter(frame, 80), color: colors.muted, fontSize: 13 }}>Plan-based access · tenant-scoped workspace · daily operations</div>
    </Background>
  );
};
