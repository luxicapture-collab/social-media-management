import { ArrowLeft, Check, Clapperboard, Download, ExternalLink, Hand, RotateCcw, Undo2 } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { approveAction, dropAction, greenlightAction, markPostedAction, restoreAction, retryAction, reviseAction, saveCaptionsAction, unscheduleAction } from "@/app/actions";
import { CaptionEditor } from "@/components/caption-editor";
import { ActionButton, ActionForm, SubmitButton } from "@/components/forms";
import { compact, FormatBadge, mediaSrc, PlatformChips, PlatformGlyph, SectionCard, StatusPill, TextDir, timeAgo, usd } from "@/components/ui";
import { engagementRate } from "@/domain/analytics";
import { formatLocal, localDateTimeString } from "@/domain/time";
import { PLATFORM_LABEL, type PostMetrics } from "@/domain/types";
import { requireUser } from "@/server/auth/dal";
import { contentDetail } from "@/server/queries";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await contentDetail(id);
  return { title: d?.item.title ?? "Content" };
}

const PUB_STATUS: Record<string, string> = {
  pending: "text-muted",
  scheduled: "text-success border-success/40",
  publishing: "text-info border-info/40",
  published: "text-success border-success/40",
  failed: "text-danger border-danger/40",
  canceled: "text-faint",
};

const METRIC_LABELS: Array<[keyof PostMetrics, string]> = [
  ["reach", "Reach"],
  ["views", "Views"],
  ["impressions", "Impressions"],
  ["likes", "Likes"],
  ["comments", "Comments"],
  ["shares", "Shares"],
  ["saves", "Saves"],
  ["clicks", "Clicks"],
  ["profileVisits", "Profile visits"],
  ["follows", "Follows"],
];

function Metrics({ m }: { m: PostMetrics }) {
  const er = engagementRate(m);
  const rows = METRIC_LABELS.filter(([k]) => m[k] !== undefined);
  return (
    <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
      {rows.map(([k, label]) => (
        <div key={k}>
          <dt className="text-[11px] text-muted">{label}</dt>
          <dd className="font-semibold tabular-nums">{compact(m[k] as number)}</dd>
        </div>
      ))}
      {er !== undefined ? (
        <div>
          <dt className="text-[11px] text-muted">Engagement</dt>
          <dd className="font-semibold tabular-nums">{er.toFixed(1)}%</dd>
        </div>
      ) : null}
      {m.retention3s !== undefined ? (
        <div>
          <dt className="text-[11px] text-muted">Held at 3s</dt>
          <dd className="font-semibold tabular-nums">{Math.round(m.retention3s * 100)}%</dd>
        </div>
      ) : null}
    </dl>
  );
}

export default async function ContentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await params;
  const d = await contentDetail(id);
  if (!d) notFound();
  const { item, client, pubs, tasks, files } = d;
  const tz = client.timezone;
  const plan = item.production;
  const variants = [...new Map(item.media.map((m) => [m.assetId, m])).values()];
  const videos = variants.filter((m) => m.kind === "video");
  const images = variants.filter((m) => m.kind === "image");
  const pdfs = variants.filter((m) => m.kind === "pdf");
  const editableCaptions = ["concept", "approved"].includes(item.status);
  const scheduledLocal = item.scheduledAt ? localDateTimeString(item.scheduledAt, tz).slice(0, 16) : "";
  const doneTasks = tasks.filter((t) => t.status === "completed").length;

  return (
    <div>
      <Link href="/approvals" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-fg">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Approvals
      </Link>
      <div className="mb-5">
        <div className="mb-2 flex flex-wrap items-center gap-1.5">
          <StatusPill status={item.status} />
          <FormatBadge format={item.format} />
          <PlatformChips platforms={item.platforms} />
          {item.trialReel ? <span className="badge">Trial reel</span> : null}
          {item.experimentId ? <span className="badge border-info/40 text-info">Experiment</span> : null}
        </div>
        <h1 className="h-display text-2xl sm:text-3xl" dir="auto">
          {item.title}
        </h1>
        <p className="mt-1 text-sm text-muted">
          <Link href={`/clients/${client.id}`} className="hover:text-fg">
            {client.name}
          </Link>
          {item.angle ? ` · ${item.angle.replace(/_/g, " ")}` : ""}
          {item.scheduledAt ? ` · ${formatLocal(item.scheduledAt, tz)} (${tz})` : ""}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:grid-rows-[auto_1fr]">
        {/* Phone order: the piece, the decision, then the details. Desktop: piece + details left, decision right. */}
        <div className="min-w-0 space-y-6 empty:hidden lg:col-start-1 lg:row-start-1">
          {variants.length ? (
            <SectionCard title={`Deliverables · ${variants.length}`}>
              <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-2">
                {videos.map((v) => (
                  <figure key={v.assetId} className="overflow-hidden rounded-xl border border-border bg-black">
                    <video src={mediaSrc(v.url)} poster={v.coverUrl ? mediaSrc(v.coverUrl) : undefined} controls playsInline preload="metadata" className="mx-auto max-h-[70vh] w-full object-contain" />
                    <figcaption className="flex items-center justify-between bg-surface px-3 py-2 text-xs text-muted">
                      <span>Video {v.aspect}</span>
                      <a href={mediaSrc(v.url)} download className="inline-flex items-center gap-1 hover:text-fg">
                        <Download className="h-3.5 w-3.5" aria-hidden /> Download
                      </a>
                    </figcaption>
                  </figure>
                ))}
                {images.map((v, i) => (
                  <figure key={v.assetId} className="overflow-hidden rounded-xl border border-border bg-black">
                    <img src={mediaSrc(v.url)} alt={`Frame ${i + 1}`} className="mx-auto max-h-[70vh] w-full object-contain" />
                    <figcaption className="flex items-center justify-between bg-surface px-3 py-2 text-xs text-muted">
                      <span>
                        Frame {i + 1} · {v.aspect}
                      </span>
                      <a href={mediaSrc(v.url)} download className="inline-flex items-center gap-1 hover:text-fg">
                        <Download className="h-3.5 w-3.5" aria-hidden /> Download
                      </a>
                    </figcaption>
                  </figure>
                ))}
              </div>
              {pdfs.map((p) => (
                <a key={p.assetId} href={mediaSrc(p.url)} target="_blank" rel="noreferrer" className="btn btn-sm mt-3">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden /> LinkedIn document carousel (PDF)
                </a>
              ))}
            </SectionCard>
          ) : null}
        </div>

        {/* ------------------------------------------------ right: decisions */}
        <div className="min-w-0 space-y-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
          {item.status === "concept" ? (
            <SectionCard title="Green-light">
              <p className="text-sm text-muted">
                Production starts when you green-light: images, motion, voice and music are generated for an estimated <span className="font-semibold text-fg">{usd(item.quote?.totalUsd ?? 0)}</span>. If real costs run more than 15% over, the agent stops and asks again.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ActionButton action={greenlightAction.bind(null, item.id)} className="btn-primary">
                  <Clapperboard className="h-4 w-4" aria-hidden /> Green-light production
                </ActionButton>
                <ActionButton action={dropAction.bind(null, item.id)} className="btn-ghost text-muted" confirm="Drop this concept?">
                  Drop
                </ActionButton>
              </div>
              <ActionForm action={reviseAction.bind(null, item.id)} className="mt-4 space-y-2">
                <label className="label" htmlFor="note">
                  Or ask for changes
                </label>
                <textarea id="note" name="note" rows={3} className="input" placeholder="e.g. Make the hook about the rain, not the brand. Shorter captions on LinkedIn." dir="auto" />
                <SubmitButton className="btn-sm">Send back to the agent</SubmitButton>
              </ActionForm>
            </SectionCard>
          ) : null}

          {item.status === "review" ? (
            <SectionCard title="Approve the cut">
              <ActionForm action={approveAction.bind(null, item.id)} className="space-y-4">
                <CaptionEditor captions={item.captions} platforms={item.platforms} format={item.format} />
                <div>
                  <label className="label" htmlFor="scheduledAt">
                    Publish at ({tz})
                  </label>
                  <input id="scheduledAt" name="scheduledAt" type="datetime-local" className="input" defaultValue={scheduledLocal} />
                  <p className="mt-1 text-xs text-muted">Leave as proposed, or the scheduler picks the best open slot if empty.</p>
                </div>
                <SubmitButton className="btn-primary w-full" pendingText="Approving…">
                  <Check className="h-4 w-4" aria-hidden /> Approve & schedule
                </SubmitButton>
              </ActionForm>
              <ActionForm action={reviseAction.bind(null, item.id)} className="mt-5 space-y-2 border-t border-border pt-4">
                <label className="label" htmlFor="cutnote">
                  Request changes to the cut
                </label>
                <textarea id="cutnote" name="note" rows={3} className="input" placeholder="e.g. Cut shot 3, slower push-in on the opener, warmer grade." dir="auto" />
                <div className="flex gap-2">
                  <SubmitButton className="btn-sm">Send back</SubmitButton>
                  <ActionButton action={dropAction.bind(null, item.id)} className="btn-ghost btn-sm text-muted" confirm="Drop this piece?">
                    Drop
                  </ActionButton>
                </div>
              </ActionForm>
            </SectionCard>
          ) : null}

          {["greenlit", "producing"].includes(item.status) ? (
            <SectionCard title="In production">
              <p className="text-sm text-muted">
                {tasks.length ? `${doneTasks} of ${tasks.length} generation tasks finished.` : "Queued for production."} The cut lands in Approvals when it&apos;s assembled. Spent so far {usd(item.actualCostUsd)} of {usd(item.quote?.totalUsd ?? 0)}.
              </p>
              <div className="mt-3 h-2 rounded-full bg-viz-track">
                <div className="h-full rounded-full bg-viz-1" style={{ width: `${tasks.length ? Math.round((doneTasks / tasks.length) * 100) : 4}%` }} />
              </div>
            </SectionCard>
          ) : null}

          {item.status === "revise" ? (
            <SectionCard title="Revising">
              <p className="text-sm text-muted">The agent is reworking the {item.revisionOf === "cut" ? "cut" : "concept"} from your note. It comes back here for another look.</p>
            </SectionCard>
          ) : null}

          {item.status === "approved" ? (
            <SectionCard title="Scheduling">
              <p className="text-sm text-muted">Approved. The agent is creating the per-platform posts now.</p>
            </SectionCard>
          ) : null}

          {item.status === "scheduled" ? (
            <SectionCard title="Scheduled">
              <p className="text-sm text-muted">Need to change captions or timing? Pull it back — pending posts are canceled and it returns to review.</p>
              <ActionButton action={unscheduleAction.bind(null, item.id)} className="btn-sm mt-3" confirm="Pull this back from the schedule?">
                <Undo2 className="h-3.5 w-3.5" aria-hidden /> Pull back to edit
              </ActionButton>
            </SectionCard>
          ) : null}

          {item.status === "failed" ? (
            <SectionCard title="Failed">
              <p className="text-sm text-muted">{item.agentNote ?? "Something failed along the way."}</p>
              <ActionButton action={retryAction.bind(null, item.id)} className="btn-primary btn-sm mt-3">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Retry
              </ActionButton>
            </SectionCard>
          ) : null}

          {item.status === "dropped" ? (
            <SectionCard title="Dropped">
              <ActionButton action={restoreAction.bind(null, item.id)} className="btn-sm">
                <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Restore as concept
              </ActionButton>
            </SectionCard>
          ) : null}

          {item.status !== "review" && item.format !== "story" ? (
            <SectionCard title="Captions">
              {editableCaptions ? (
                <ActionForm action={saveCaptionsAction.bind(null, item.id)} className="space-y-3">
                  <CaptionEditor captions={item.captions} platforms={item.platforms} format={item.format} />
                  <SubmitButton className="btn-sm">Save captions</SubmitButton>
                </ActionForm>
              ) : (
                <CaptionEditor captions={item.captions} platforms={item.platforms} format={item.format} readOnly />
              )}
            </SectionCard>
          ) : null}

          {Object.values(item.firstComments).some(Boolean) ? (
            <SectionCard title="First comments">
              <ul className="space-y-2 text-sm">
                {Object.entries(item.firstComments)
                  .filter(([, v]) => v)
                  .map(([p, v]) => (
                    <li key={p}>
                      <span className="text-xs text-muted">{PLATFORM_LABEL[p as keyof typeof PLATFORM_LABEL]}</span>
                      <p dir="auto">{v}</p>
                    </li>
                  ))}
              </ul>
            </SectionCard>
          ) : null}

          {pubs.length ? (
            <SectionCard title="Posts">
              <ul className="space-y-4">
                {pubs.map((p) => (
                  <li key={p.id} className="rounded-xl border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <PlatformGlyph platform={p.platform} />
                      <span className="text-sm font-medium">{PLATFORM_LABEL[p.platform]}</span>
                      <span className={`badge ${PUB_STATUS[p.status] ?? ""}`}>{p.status}</span>
                      {p.route === "metricool" ? <span className="badge">via Metricool</span> : null}
                      {p.permalink ? (
                        <a href={p.permalink} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 text-xs text-accent hover:underline">
                          View <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {p.publishedAt ? `Published ${formatLocal(p.publishedAt, tz)}` : `Scheduled ${formatLocal(p.scheduledAt, tz)}`}
                      {p.metricsUpdatedAt ? ` · metrics ${timeAgo(p.metricsUpdatedAt)}` : ""}
                    </p>
                    {p.lastError ? <p className="mt-1 text-xs text-danger">{p.lastError}</p> : null}
                    {p.manual && p.status !== "published" && p.status !== "canceled" ? (
                      <div className="mt-2 rounded-lg bg-surface-2 p-2.5 text-xs">
                        <p className="flex items-center gap-1.5 font-medium">
                          <Hand className="h-3.5 w-3.5 text-accent" aria-hidden /> Post this one by hand
                        </p>
                        <p className="mt-1 text-muted">Interactive stickers can&apos;t be added through the API. Download the frames, add the stickers in the app, then mark it posted so the agent tracks it.</p>
                        <ActionButton action={markPostedAction.bind(null, p.id, item.id)} className="btn-sm mt-2">
                          Mark as posted
                        </ActionButton>
                      </div>
                    ) : null}
                    {p.metrics ? (
                      <div className="mt-3">
                        <Metrics m={p.metrics} />
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {item.quote ? (
            <SectionCard title="Quote">
              <table className="w-full text-sm">
                <tbody className="divide-y divide-border">
                  {item.quote.items.map((q, i) => (
                    <tr key={i}>
                      <td className="py-1.5 pr-2">
                        <span className="text-fg">{q.tool}</span> <span className="text-xs text-muted">{q.model}</span>
                        {q.note ? <span className="block text-xs text-faint">{q.note}</span> : null}
                      </td>
                      <td className="py-1.5 pr-2 text-right text-xs text-muted tabular-nums">
                        {q.units} {q.unit}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{usd(q.usd)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="pt-2">Estimated total</td>
                    <td />
                    <td className="pt-2 text-right tabular-nums">{usd(item.quote.totalUsd)}</td>
                  </tr>
                  {item.actualCostUsd ? (
                    <tr className="text-muted">
                      <td className="pt-1">Spent</td>
                      <td />
                      <td className="pt-1 text-right tabular-nums">{usd(item.actualCostUsd)}</td>
                    </tr>
                  ) : null}
                </tfoot>
              </table>
            </SectionCard>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-2">
          <SectionCard title="Concept">
            {item.hook ? (
              <div className="mb-4">
                <p className="label">Hook</p>
                <p className="border-l-2 border-accent/60 pl-3 leading-relaxed" dir="auto">
                  {item.hook}
                </p>
              </div>
            ) : null}
            {item.beats.length ? (
              <div className="mb-4">
                <p className="label">Beats</p>
                <ol className="space-y-1 text-sm">
                  {item.beats.map((b, i) => (
                    <li key={i} dir="auto">
                      {b}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {item.rationale ? (
              <div className="mb-4">
                <p className="label">Why this should work</p>
                <p className="text-sm leading-relaxed text-muted">{item.rationale}</p>
              </div>
            ) : null}
            {item.storyFrames.length ? (
              <div className="mb-4">
                <p className="label">Story frames</p>
                <ol className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                  {item.storyFrames.map((f, i) => (
                    <li key={i} className="rounded-xl border border-border bg-surface-2 p-3 text-sm">
                      <span className="text-[11px] text-faint">Frame {i + 1}</span>
                      <p dir="auto">{f.text}</p>
                      {f.sticker ? <p className="mt-1 text-xs text-accent">Sticker: {f.sticker}</p> : null}
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {item.critique ? (
              <div className="mb-4">
                <p className="label">Critic · {item.critique.score}/10</p>
                <ul className="list-disc space-y-0.5 pl-4 text-sm text-muted">
                  {item.critique.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </div>
            ) : null}
            {item.agentNote ? <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">{item.agentNote}</p> : null}
            {item.revisionNote ? (
              <p className="mt-3 rounded-xl border border-info/30 px-3 py-2 text-sm">
                <span className="text-info">Your note:</span> {item.revisionNote}
              </p>
            ) : null}
          </SectionCard>

          {plan ? (
            <SectionCard title="Production plan">
              <p className="mb-3 text-sm text-muted">
                {plan.aspect}
                {plan.durationSec ? ` · ${plan.durationSec}s` : ""} · {plan.shots.length} shot{plan.shots.length === 1 ? "" : "s"}
                {plan.frames.length ? ` · ${plan.frames.length} frame${plan.frames.length === 1 ? "" : "s"}` : ""}
                {plan.voiceover ? " · voiceover" : ""}
                {plan.music ? " · music" : ""}
                {plan.burnCaptions && plan.voiceover ? " · burned captions" : ""}
              </p>
              {plan.shots.length ? (
                <ol className="space-y-3">
                  {plan.shots.map((s) => (
                    <li key={s.id} className="rounded-xl border border-border p-3">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span className="font-semibold text-fg">{s.id}</span>
                        <span className="badge">{s.kind}</span>
                        <span className="badge">{s.model}</span>
                        <span>{s.durationSec}s</span>
                        {s.camera ? <span>· {s.camera}</span> : null}
                        {s.transitionIn !== "cut" ? <span>· {s.transitionIn} in</span> : null}
                      </div>
                      <p className="mt-1.5 text-sm leading-relaxed">{s.prompt}</p>
                    </li>
                  ))}
                </ol>
              ) : null}
              {plan.frames.length ? (
                <ol className="mt-3 space-y-3">
                  {plan.frames.map((f, i) => (
                    <li key={i} className="rounded-xl border border-border p-3 text-sm">
                      <span className="text-xs text-muted">Frame {i + 1}</span>
                      {f.title ? (
                        <p className="font-semibold" dir="auto">
                          {f.title}
                        </p>
                      ) : null}
                      {f.body ? (
                        <p className="text-muted" dir="auto">
                          {f.body}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs leading-relaxed text-faint">{f.prompt}</p>
                    </li>
                  ))}
                </ol>
              ) : null}
              {plan.voiceover ? (
                <div className="mt-4">
                  <p className="label">
                    Voiceover · {plan.voiceover.language} · {plan.voiceover.voiceStyle}
                  </p>
                  <p className="rounded-xl bg-surface-2 px-3 py-2 text-sm leading-relaxed">
                    <TextDir text={plan.voiceover.script} />
                  </p>
                </div>
              ) : null}
              {plan.music ? (
                <p className="mt-3 text-sm text-muted">
                  <span className="text-fg">Music:</span> {plan.music.prompt}
                </p>
              ) : null}
            </SectionCard>
          ) : null}

          {tasks.length ? (
            <SectionCard title={`Generation · ${doneTasks}/${tasks.length} done`}>
              <ul className="divide-y divide-border text-sm">
                {tasks.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                    <span className="w-24 shrink-0 font-mono text-xs text-muted">{t.key}</span>
                    <span className="badge">{t.provider}</span>
                    <span className="badge">{t.kind}</span>
                    <span className={`badge ${t.status === "completed" ? "text-success border-success/40" : t.status === "failed" ? "text-danger border-danger/40" : "text-info border-info/40"}`}>{t.status}</span>
                    <span className="ml-auto text-xs text-faint tabular-nums">{usd(t.estCostUsd)}</span>
                    {t.error ? <p className="w-full text-xs text-danger">{t.error}</p> : null}
                  </li>
                ))}
              </ul>
            </SectionCard>
          ) : null}

          {files.length ? (
            <details className="card card-pad">
              <summary className="cursor-pointer text-sm font-semibold text-muted">All files · {files.length}</summary>
              <ul className="mt-3 space-y-1 text-xs">
                {files.map((f) => (
                  <li key={f.id} className="flex items-center gap-2">
                    <span className="badge">{f.kind}</span>
                    <a href={mediaSrc(f.url)} target="_blank" rel="noreferrer" className="truncate text-muted hover:text-fg">
                      {f.role}
                    </a>
                    <span className="ml-auto text-faint">{f.source}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      </div>
    </div>
  );
}
