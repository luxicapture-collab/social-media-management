import { ChevronRight, LogOut } from "lucide-react";
import Link from "next/link";
import { logoutAction } from "@/app/actions";
import { MORE_LINKS } from "@/components/nav-items";
import { InstallHint } from "@/components/pwa";
import { PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/dal";
import { navCounts } from "@/server/queries";

export const metadata = { title: "More" };

export default async function MorePage() {
  const user = await requireUser();
  const counts = await navCounts();
  return (
    <div className="max-w-lg">
      <PageHeader title="More" subtitle={user.email} />
      <ul className="card divide-y divide-border">
        {MORE_LINKS.map(({ href, label, Icon, key }) => (
          <li key={href}>
            <Link href={href} className="flex items-center gap-3 px-4 py-3.5 text-sm hover:bg-surface-2">
              <Icon className="h-4 w-4 text-muted" aria-hidden />
              {label}
              {key && counts[key] ? <span className="ml-auto rounded-full bg-accent px-1.5 text-[11px] leading-5 font-semibold text-accent-fg">{counts[key]}</span> : <ChevronRight className="ml-auto h-4 w-4 text-faint" aria-hidden />}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <InstallHint />
        <form action={logoutAction}>
          <button type="submit" className="btn btn-ghost btn-sm text-muted">
            <LogOut className="h-4 w-4" aria-hidden /> Sign out
          </button>
        </form>
      </div>
    </div>
  );
}
