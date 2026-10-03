import Link from "next/link";
import { finishConnectAction } from "@/app/actions";
import { ActionButton } from "@/components/forms";
import { PageHeader, PlatformGlyph } from "@/components/ui";
import { PLATFORM_LABEL } from "@/domain/types";
import { requireUser } from "@/server/auth/dal";
import { pendingAccounts } from "@/server/platforms/oauth";

export const metadata = { title: "Choose account" };

export default async function ConnectPickPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ state?: string }> }) {
  await requireUser();
  const { id } = await params;
  const { state } = await searchParams;
  const pending = state ? await pendingAccounts(state) : null;

  if (!pending || pending.clientId !== id) {
    return (
      <div>
        <PageHeader title="Connect session expired" subtitle="Start the connection again from the client page." />
        <Link href={`/clients/${id}`} className="btn">
          Back to client
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl">
      <PageHeader title="Which account is this client's?" subtitle="Your login can manage several pages and profiles. Pick the one that belongs to this client." />
      <ul className="space-y-3">
        {pending.accounts.map((acc) => (
          <li key={acc.key} className="card card-pad flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium">{acc.label}</p>
              <p className="mt-1 flex flex-wrap gap-1.5">
                {acc.connections.map((c) => (
                  <span key={c.platform + c.accountId} className="badge">
                    <PlatformGlyph platform={c.platform} /> {PLATFORM_LABEL[c.platform]}
                    {c.handle ? ` @${c.handle.replace(/^@/, "")}` : ""}
                  </span>
                ))}
              </p>
            </div>
            <ActionButton action={finishConnectAction.bind(null, state!, acc.key)} className="btn-primary btn-sm">
              Use this account
            </ActionButton>
          </li>
        ))}
      </ul>
      {!pending.accounts.length ? <p className="text-sm text-muted">No eligible accounts were found for this login. For Instagram, the account must be a Business or Creator account linked to a Facebook Page you manage.</p> : null}
    </div>
  );
}
