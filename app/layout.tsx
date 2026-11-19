import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Serif, Inter, Inter_Tight, Montserrat } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ConfirmHost } from "@/components/ui/confirm-dialog";
import { NativeControls } from "@/components/ui/native-controls";
import { ThemeProvider } from "@/components/theme-provider";

// Typefaces (docs/design/BRAND.md, UI-CONSISTENCY.md §0). Self-hosted at build by next/font, so no
// page asks Google for CSS at runtime. All variable fonts: every weight comes from one file.
// Inter is the UI face, Inter Tight the display face (titles, large numbers), Geist Mono the face
// for identifiers. Montserrat is the brand face, kept for the marketing pages (`.type-brand`).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat", display: "swap" });
// The landing page's accent (owner decision 2026-11-03): one italic serif word inside a headline.
const instrumentSerif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["italic"], variable: "--font-accent", display: "swap" });
const fontVariables = [inter.variable, interTight.variable, geistMono.variable, montserrat.variable, instrumentSerif.variable].join(" ");

// The origin link previews resolve against: WhatsApp and the rest fetch the preview image
// (app/opengraph-image.tsx) from an absolute URL, so it has to be the public site, not localhost.
const siteUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://www.insurvas.com");

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Insurvas",
  description: "Insurvas insurance operations workspace",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0d4037" },
    { media: "(prefers-color-scheme: dark)", color: "#06211c" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The theme class is applied after hydration by ThemeProvider; suppressing the html attribute
    // keeps browser theme extensions from turning a cosmetic class change into a hydration error.
    <html lang="en" className={fontVariables} suppressHydrationWarning>
      <head>
        {/* The saved theme before the first paint (Next guide "preventing flash before hydration"):
            without it a dark-mode page painted light, then switched. ThemeProvider keeps it in sync
            afterwards with the same rule: a saved light/dark wins, otherwise the system's. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("theme");var d=t==="dark"||((t===null||t==="system")&&window.matchMedia("(prefers-color-scheme: dark)").matches);var r=document.documentElement;if(d)r.classList.add("dark");r.style.colorScheme=d?"dark":"light"}catch(e){}})()`,
          }}
        />
      </head>
      <body>
        <ThemeProvider>
          {children}
          <Toaster />
          <ConfirmHost />
          {/* Every native dropdown and date field opens the app's own panel (the control foundation, 2026-11-02). */}
          <NativeControls />
        </ThemeProvider>
      </body>
    </html>
  );
}
