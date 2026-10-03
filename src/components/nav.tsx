"use client";

import clsx from "clsx";
import { CheckSquare, Clapperboard, Home, Inbox, LogOut, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { logoutAction } from "@/app/actions";
import { NAV_ITEMS } from "./nav-items";

export interface NavCounts {
  approvals: number;
  inbox: number;
  alerts: number;
}



const MOBILE = ["/", "/approvals", "/studio", "/inbox", "/more"] as const;

function active(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

function CountBadge({ n }: { n: number }) {
  if (!n) return null;
  return <span className="ml-auto min-w-5 rounded-full bg-accent px-1.5 text-center text-[11px] leading-5 font-semibold text-accent-fg">{n > 99 ? "99+" : n}</span>;
}

export function Sidebar({ counts, demo }: { counts: NavCounts; demo: boolean }) {
  const pathname = usePathname();
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-surface px-3 py-5 lg:flex">
      <Link href="/" className="mb-6 flex items-center gap-2.5 px-2">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent font-display text-lg font-bold text-accent-fg">L</span>
        <span>
          <span className="block text-sm leading-tight font-semibold">Luxi Agent</span>
          <span className="block text-[11px] leading-tight text-muted">{demo ? "Demo mode" : "Social media team"}</span>
        </span>
      </Link>
      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV_ITEMS.map(({ href, label, Icon, key }) => (
          <Link
            key={href}
            href={href}
            className={clsx(
              "flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
              active(pathname, href) ? "bg-accent-soft text-fg" : "text-muted hover:bg-surface-2 hover:text-fg",
            )}
          >
            <Icon className="h-4 w-4" aria-hidden />
            {label}
            {key ? <CountBadge n={counts[key]} /> : null}
          </Link>
        ))}
      </nav>
      <form action={logoutAction} className="border-t border-border pt-3">
        <button type="submit" className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-muted transition-colors hover:bg-surface-2 hover:text-fg">
          <LogOut className="h-4 w-4" aria-hidden />
          Sign out
        </button>
      </form>
    </aside>
  );
}

export function BottomNav({ counts }: { counts: NavCounts }) {
  const pathname = usePathname();
  const labels: Record<(typeof MOBILE)[number], { label: string; Icon: typeof Home; n?: number }> = {
    "/": { label: "Today", Icon: Home },
    "/approvals": { label: "Approve", Icon: CheckSquare, n: counts.approvals },
    "/studio": { label: "Studio", Icon: Clapperboard },
    "/inbox": { label: "Inbox", Icon: Inbox, n: counts.inbox },
    "/more": { label: "More", Icon: Menu, n: counts.alerts },
  };
  return (
    <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface/95 backdrop-blur lg:hidden">
      <ul className="mx-auto grid max-w-lg grid-cols-5">
        {MOBILE.map((href) => {
          const { label, Icon, n } = labels[href];
          const on = href === "/more" ? ["/more", "/calendar", "/analytics", "/alerts", "/clients", "/chat", "/playbooks", "/settings"].some((p) => active(pathname, p)) : active(pathname, href);
          return (
            <li key={href}>
              <Link href={href} className={clsx("relative flex flex-col items-center gap-0.5 py-2.5 text-[11px]", on ? "text-accent" : "text-muted")}>
                <Icon className="h-5 w-5" aria-hidden />
                {label}
                {n ? <span className="absolute top-1.5 right-[calc(50%-18px)] h-2 w-2 rounded-full bg-accent" aria-label={`${n} waiting`} /> : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

