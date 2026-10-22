import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

// The brand typeface (docs/design/BRAND.md). Self-hosted at build by next/font, so no page asks
// Google for CSS at runtime. Variable font: every weight the type scale uses comes from one file.
const montserrat = Montserrat({ subsets: ["latin"], variable: "--font-montserrat", display: "swap" });

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
    <html lang="en" className={montserrat.variable} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          {children}
          <Toaster position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
