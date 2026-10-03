import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import type { ReactNode } from "react";
import { ServiceWorkerRegistrar } from "@/components/pwa";
import "./globals.css";

const inter = localFont({
  src: [
    { path: "../../assets/fonts/Inter_400Regular.ttf", weight: "400", style: "normal" },
    { path: "../../assets/fonts/Inter_500Medium.ttf", weight: "500", style: "normal" },
    { path: "../../assets/fonts/Inter_600SemiBold.ttf", weight: "600", style: "normal" },
    { path: "../../assets/fonts/Inter_700Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-inter",
  display: "swap",
});

const playfair = localFont({
  src: [
    { path: "../../assets/fonts/PlayfairDisplay_700Bold.ttf", weight: "700", style: "normal" },
    { path: "../../assets/fonts/PlayfairDisplay_600SemiBold_Italic.ttf", weight: "600", style: "italic" },
  ],
  variable: "--font-playfair",
  display: "swap",
});

// Farsi text only: not preloaded, fetched when RTL content is on screen.
const vazir = localFont({
  src: [
    { path: "../../assets/fonts/Vazirmatn_500Medium.ttf", weight: "500", style: "normal" },
    { path: "../../assets/fonts/Vazirmatn_700Bold.ttf", weight: "700", style: "normal" },
  ],
  variable: "--font-vazir",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: { default: "Luxi Agent", template: "%s · Luxi Agent" },
  description: "Plans, produces, schedules, measures and pivots your clients' Instagram, Facebook, LinkedIn and X content — with you approving every step that matters.",
  applicationName: "Luxi Agent",
  appleWebApp: { capable: true, title: "Luxi Agent", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
  icons: {
    icon: [
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0d0c0b" },
    { media: "(prefers-color-scheme: light)", color: "#f6f2ec" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${playfair.variable} ${vazir.variable}`}>
      <body>
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
