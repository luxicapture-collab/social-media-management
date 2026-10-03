import { Bell } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { BottomNav, Sidebar } from "@/components/nav";
import { requireUser } from "@/server/auth/dal";
import { config } from "@/server/config";
import { navCounts } from "@/server/queries";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await requireUser();
  const counts = await navCounts();
  const demo = config().demo;
  return (
    <div className="flex min-h-dvh">
      <Sidebar counts={counts} demo={demo} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-bg/90 px-4 pb-2.5 backdrop-blur lg:hidden"
          style={{ paddingTop: "max(0.625rem, env(safe-area-inset-top))" }}
        >
          <Link href="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent font-display text-base font-bold text-accent-fg">L</span>
            <span className="text-sm font-semibold">Luxi Agent</span>
            {demo ? <span className="badge">Demo</span> : null}
          </Link>
          <Link href="/alerts" className="relative rounded-lg p-2 text-muted hover:text-fg" aria-label={counts.alerts ? `Alerts, ${counts.alerts} unread` : "Alerts"}>
            <Bell className="h-5 w-5" aria-hidden />
            {counts.alerts ? <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-accent" aria-hidden /> : null}
          </Link>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-5 pb-28 sm:px-6 lg:px-8 lg:pt-8 lg:pb-12">{children}</main>
      </div>
      <BottomNav counts={counts} />
    </div>
  );
}
