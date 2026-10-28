import type { Metadata, Viewport } from "next";
import { Geist_Mono, Inter, Inter_Tight, Montserrat } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { ConfirmHost } from "@/components/ui/confirm-dialog";
import { ThemeProvider } from "@/components/theme-provider";

// Typefaces (docs/design/BRAND.md, UI-CONSISTENCY.md §0). Self-hosted at build by next/font, so no
// page asks Google for CSS at runtime. All variable fonts: every weight comes from one file.
// Inter is the UI face, Inter Tight the display face (titles, large numbers), Geist Mono the face
// for identifiers. Montserrat is the brand face, kept for the marketing pages (`.type-brand`).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const interTight = Inter_Tight({ subsets: ["latin"], variable: "--font-inter-tight", display: "swap" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat", display: "swap" });
const fontVariables = [inter.variable, interTight.variable, geistMono.variable, montserrat.variable].join(" ");

export const metadata: Metadata = {
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
      <body>
        <ThemeProvider>
          {children}
          <Toaster />
          <ConfirmHost />
        </ThemeProvider>
      </body>
    </html>
  );
}
