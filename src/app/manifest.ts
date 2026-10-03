import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Luxi Social Agent",
    short_name: "Luxi Agent",
    description: "Plans, produces, schedules and measures your clients' social content — you approve what matters.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0d0c0b",
    theme_color: "#0d0c0b",
    categories: ["business", "productivity", "social"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Approvals", url: "/approvals", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "New scenario", url: "/studio", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Inbox", url: "/inbox", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
