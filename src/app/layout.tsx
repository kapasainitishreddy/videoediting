import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ServiceWorkerRegistrar from "@/components/ServiceWorkerRegistrar";
import { ErrorBoundary } from "@/components/ErrorBoundary";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ViralEdit AI — Reverse-engineer any viral edit",
  description:
    "Paste any reel and get the exact cut map, transitions, and beat sync — frame by frame. Then let AI edit your clips to match.",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "ViralEdit AI" },
  icons: { apple: "/icons/apple-touch-icon.png" },
};

// No maximumScale/userScalable lock: blocking pinch-zoom is an
// accessibility anti-pattern (WCAG 1.4.4) — low-vision users need it.
export const viewport: Viewport = {
  themeColor: "#0d0d0d",
  width: "device-width",
  initialScale: 1,
  // required for env(safe-area-inset-*) to resolve to nonzero values
  // instead of 0 on notched/home-indicator devices
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <div
          className="mx-auto w-full max-w-md flex flex-col min-h-dvh"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          }}
        >
          <ErrorBoundary>{children}</ErrorBoundary>
        </div>
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
