import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";

/**
 * The link preview: the large card WhatsApp, Slack, LinkedIn and X show when someone pastes an
 * Insurvas link (owner, 2026-11-13: the small favicon thumbnail should be a full expandable preview,
 * like other product sites have). 1200x560: a little shorter than the usual 1200x630 (owner, 2026-11-13: "a bit less in length"); the apps keep
 * the image's own proportions, so the card in the chat is shorter too.
 *
 * It is the landing page in one frame: the deep olive band with the brand's mint light through it,
 * the logo, and the promise — "Know what every lead cost you", with the one italic serif word the
 * landing headlines use. Fonts are the landing's own (Inter Tight, Inter, Instrument Serif), kept as
 * TTF in `assets/og/` because the image renderer cannot read next/font's woff2.
 *
 * Generated once at build and cached (no request-time data). Every route inherits it.
 */
export const alt = "Insurvas: know what every lead cost you. The inbound floor, the dialer, applications and the book of business in one workspace.";
export const size = { width: 1200, height: 560 };
export const contentType = "image/png";

const asset = (...parts: string[]) => readFile(join(process.cwd(), ...parts));

export default async function OpengraphImage() {
  const [logo, display, serif, body] = await Promise.all([
    asset("public", "brand", "insurvas-logo-on-dark.svg"),
    asset("assets", "og", "InterTight-SemiBold.ttf"),
    asset("assets", "og", "InstrumentSerif-Italic.ttf"),
    asset("assets", "og", "Inter-Medium.ttf"),
  ]);
  const logoSrc = `data:image/svg+xml;base64,${logo.toString("base64")}`;

  return new ImageResponse(
    (
      <div
        style={{
          position: "relative",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          width: "100%",
          height: "100%",
          padding: "52px 76px 50px",
          backgroundColor: "#0a362e",
          // The landing band's light, as still pools: mint rising from the lower right, a softer one
          // top left, and the deep olive held in the middle where the words sit.
          backgroundImage: [
            "radial-gradient(circle at 100% 100%, rgba(143, 245, 213, 0.75) 0%, rgba(79, 227, 187, 0.45) 22%, rgba(7, 214, 160, 0.12) 45%, rgba(7, 214, 160, 0) 62%)",
            "radial-gradient(circle at 104% 22%, rgba(7, 214, 160, 0.42) 0%, rgba(7, 214, 160, 0) 38%)",
            "radial-gradient(circle at -4% -12%, rgba(26, 150, 118, 0.5) 0%, rgba(26, 150, 118, 0) 40%)",
            "linear-gradient(160deg, #0d4037 0%, #072b24 55%, #05211c 100%)",
          ].join(", "),
          fontFamily: "Inter",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- ImageResponse renders plain <img> only */}
        <img src={logoSrc} width={240} height={56} alt="" />

        <div style={{ display: "flex", flexDirection: "column" }}>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              color: "#f3fbf8",
              fontFamily: "Inter Tight",
              fontSize: 78,
              lineHeight: 1.02,
              letterSpacing: "-0.035em",
            }}
          >
            <div style={{ display: "flex" }}>Know what every</div>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <span
                style={{
                  marginRight: 22,
                  fontFamily: "Instrument Serif",
                  fontSize: 91,
                  letterSpacing: "-0.01em",
                  color: "#8ff5d5",
                }}
              >
                lead
              </span>
              cost you.
            </div>
          </div>
          <div
            style={{
              display: "flex",
              maxWidth: 820,
              marginTop: 20,
              color: "rgba(234, 246, 242, 0.74)",
              fontSize: 28,
              lineHeight: 1.4,
            }}
          >
            The inbound floor, the dialer, applications and the book of business in one workspace.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 10 }}>
            {["Life insurance", "Health insurance"].map((line) => (
              <div
                key={line}
                style={{
                  display: "flex",
                  border: "1px solid rgba(234, 246, 242, 0.18)",
                  borderRadius: 999,
                  backgroundColor: "rgba(4, 24, 20, 0.55)",
                  padding: "9px 18px",
                  color: "#eaf6f2",
                  fontSize: 20,
                }}
              >
                {line}
              </div>
            ))}
          </div>
          <div style={{ display: "flex", color: "rgba(234, 246, 242, 0.82)", fontSize: 22 }}>insurvas.com</div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "Inter Tight", data: display, style: "normal", weight: 600 },
        { name: "Instrument Serif", data: serif, style: "italic", weight: 400 },
        { name: "Inter", data: body, style: "normal", weight: 500 },
      ],
    },
  );
}
