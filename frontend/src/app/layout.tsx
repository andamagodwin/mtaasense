import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, Manrope } from "next/font/google";
import { SessionProvider } from "@/components/session";
import { colors } from "@/lib/colors";
import "./globals.css";

// Variable font: one file covers every weight the UI uses.
const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

// Manrope has no monospace cut, so timecodes, IDs and coordinates stay in Plex Mono.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: { default: "MtaaSense · Community infrastructure intelligence", template: "%s · MtaaSense" },
  description:
    "Turn resident observations of potholes, blocked drainage and flooding into structured, evidence-backed incident records.",
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "48x48" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: colors.paper,
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${manrope.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2"
        >
          Skip to content
        </a>
        {/* The public site (app/(site)) adds the header and footer; the review dashboard (app/(dashboard)) its sidebar. */}
        <SessionProvider>{children}</SessionProvider>
      </body>
    </html>
  );
}
