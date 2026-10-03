import { Clapperboard, Eye, RefreshCcw } from "lucide-react";
import Link from "next/link";
import { dropAction, greenlightAction, retryAction } from "@/app/actions";
import { ActionButton } from "@/components/forms";
import { EmptyState, FormatBadge, mediaSrc, PageHeader, PlatformChips, StatusPill, usd } from "@/components/ui";
import { formatLocal } from "@/domain/time";
import { requireUser } from "@/server/auth/dal";
import { approvalsData, clientsList } from "@/server/queries";

export const metadata = { title: "Approvals" };

type Item = Awaited<ReturnType<typeof approvalsData>>["concepts"][number];

function When({ item, tz }: { item: Item; tz: string }) {
  return item.scheduledAt ? <span className="tabular-nums">{formatLocal(item.scheduledAt, tz)}</span> : <span>Time picked at scheduling</span>;
}

function ConceptCard({ item, tz }: { item: Item; tz: string }) {
  return (
    <article className="card card-pad flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <FormatBadge format={item.format} />
        <PlatformChips platforms={item.platforms} />
        {item.trialReel ? <span className="badge">Trial reel</span> : null}
        {item.revisionOf ? <span className="badge border-info/40 text-info">Revised</span> : null}
      </div>
      <div>
        <p className="text-xs text-muted">{item.client}</p>
        <Link href={`/content/${item.id}`} className="mt-0.5 block font-semibold leading-snug hover:text-accent">
          {item.title}
        </Link>
      </div>
      {item.hook ? (
        <p className="border-l-2 border-accent/60 pl-3 text-sm leading-relaxed" dir="auto">
          {item.hook}
        </p>
      ) : null}
      {item.rationale ? <p className="line-clamp-3 text-xs leading-relaxed text-muted">{item.rationale}</p> : null}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <When item={item} tz={tz} />
        <span>
          {item.critique ? `Critic ${item.critique.score}/10 · ` : ""}
          Quote <span className="font-semibold text-fg">{usd(item.quote?.totalUsd ?? 0)}</span>
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <ActionButton action={greenlightAction.bind(null, item.id)} className="btn-primary btn-sm">
          <Clapperboard className="h-3.5 w-3.5" aria-hidden /> Green-light
        </ActionButton>
        <Link href={`/content/${item.id}`} className="btn btn-sm">
          Open · revise
        </Link>
        <ActionButton action={dropAction.bind(null, item.id)} className="btn-ghost btn-sm text-muted" confirm="Drop this concept?">
          Drop
        </ActionButton>
      </div>
    </article>
  );
}

function CutCard({ item, tz }: { item: Item; tz: string }) {
  const video = item.media.find((m) => m.kind === "video" && m.aspect === "9:16") ?? item.media.find((m) => m.kind === "video");
  const image = item.media.find((m) => m.kind === "image");
  return (
    <article className="card overflow-hidden">
      <Link href={`/content/${item.id}`} className="block bg-black">
        {video ? (
          <video src={mediaSrc(video.url)} poster={video.coverUrl ? mediaSrc(video.coverUrl) : undefined} muted playsInline preload="metadata" className="mx-auto aspect-[9/16] max-h-80 object-contain" />
        ) : image ? (
          <img src={mediaSrc(image.url)} alt="" className="mx-auto max-h-80 object-contain" />
        ) : (
          <div className="grid h-40 place-items-center text-sm text-faint">No preview</div>
        )}
      </Link>
      <div className="card-pad space-y-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <FormatBadge format={item.format} />
          <PlatformChips platforms={item.platforms} />
        </div>
        <p className="text-xs text-muted">{item.client}</p>
        <Link href={`/content/${item.id}`} className="block font-semibold leading-snug hover:text-accent">
          {item.title}
        </Link>
        <div className="flex items-center justify-between text-xs text-muted">
          <When item={item} tz={tz} />
          <span>Spent {usd(item.actualCostUsd)}</span>
        </div>
        <Link href={`/content/${item.id}`} className="btn btn-primary btn-sm w-full">
          <Eye className="h-3.5 w-3.5" aria-hidden /> Review captions & approve
        </Link>
      </div>
    </article>
  );
}

export default async function ApprovalsPage() {
  await requireUser();
  const [d, clients] = await Promise.all([approvalsData(), clientsList()]);
  const tzOf = new Map(clients.map((c) => [c.id, c.timezone]));
  const tz = (i: Item) => tzOf.get(i.clientId) ?? "UTC";
  const empty = !d.concepts.length && !d.cuts.length && !d.working.length && !d.failed.length;

  return (
    <div className="space-y-8">
      <PageHeader title="Approvals" subtitle="Two gates: green-light a concept and its quote before anything is spent, then approve the finished cut before it's scheduled." />

      {empty ? (
        <EmptyState
          title="Nothing waiting"
          body="New concepts appear here after you give the agent a scenario."
          action={
            <Link href="/studio" className="btn btn-primary btn-sm">
              Open the Studio
            </Link>
          }
        />
      ) : null}

      {d.cuts.length ? (
        <section>
          <h2 className="section-title">Cuts ready for review · {d.cuts.length}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {d.cuts.map((i) => (
              <CutCard key={i.id} item={i} tz={tz(i)} />
            ))}
          </div>
        </section>
      ) : null}

      {d.concepts.length ? (
        <section>
          <h2 className="section-title">Concepts to green-light · {d.concepts.length}</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {d.concepts.map((i) => (
              <ConceptCard key={i.id} item={i} tz={tz(i)} />
            ))}
          </div>
        </section>
      ) : null}

      {d.working.length ? (
        <section>
          <h2 className="section-title">The agent is on it · {d.working.length}</h2>
          <ul className="card divide-y divide-border">
            {d.working.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <RefreshCcw className="h-4 w-4 shrink-0 animate-spin text-info [animation-duration:3s]" aria-hidden />
                <Link href={`/content/${i.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-accent">
                  {i.title}
                </Link>
                <span className="text-xs text-muted">{i.client}</span>
                <StatusPill status={i.status} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {d.failed.length ? (
        <section>
          <h2 className="section-title">Failed · {d.failed.length}</h2>
          <ul className="card divide-y divide-border">
            {d.failed.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link href={`/content/${i.id}`} className="min-w-0 flex-1 truncate text-sm hover:text-accent">
                  {i.title}
                </Link>
                <span className="text-xs text-muted">{i.agentNote ?? i.client}</span>
                <ActionButton action={retryAction.bind(null, i.id)} className="btn-sm">
                  Retry
                </ActionButton>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
