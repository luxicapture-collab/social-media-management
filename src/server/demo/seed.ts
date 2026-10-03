import { eq } from "drizzle-orm";
import { engagementRate, KPI_AGGREGATION, kpiValueFromAccount } from "@/domain/analytics";
import { addLocalDays, atLocalTime, localDateKey, startOfLocalDay } from "@/domain/time";
import { PLATFORMS, type Format, type Platform, type PostMetrics } from "@/domain/types";
import { logRun } from "../activity";
import { config } from "../config";
import { newId } from "../crypto";
import { getDb } from "../db/client";
import { audienceSnapshots, clients, connections, contentItems, experiments, goals, insights, kpiSnapshots, publications } from "../db/schema";
import { planScenarioJob } from "../pipeline/planning";
import { updateGoal } from "../pipeline/measurement";
import { syncCommunity } from "../pipeline/community";
import { demoAdapter, demoPostMetrics } from "../platforms/demo";
import { createClient, setGoal } from "../services/clients";
import { connectDemoAccounts, toCtx } from "../services/connections";
import { createScenario, greenlight } from "../services/content";

/**
 * Sample data for demo mode: two clients with simulated accounts, 45 days of account history,
 * a month of published posts with metrics, goals with real pacing, one running experiment, a
 * freshly planned scenario and one concept green-lit so the worker renders a cut.
 * Everything is clearly labelled as sample data and is skipped if any client already exists.
 */

const HISTORY_DAYS = 45;
const GOAL_AGE_DAYS = 30;
const GOAL_LENGTH_DAYS = 90;

interface PastPost {
  title: string;
  format: Format;
  platforms: Platform[];
  daysAgo: number;
  hour: number;
  angle: string;
  hook: string;
}

const LUXI_POSTS: PastPost[] = [
  { title: "Rooftop perfume film — the rain take", format: "reel", platforms: ["instagram", "facebook", "x"], daysAgo: 27, hour: 19, angle: "behind_the_scenes", hook: "Rain machine on, one take left, 40 seconds of light." },
  { title: "Before / after: grading a desert wedding", format: "carousel", platforms: ["instagram", "linkedin"], daysAgo: 24, hour: 12, angle: "transformation", hook: "Same frame. Ninety minutes of grade." },
  { title: "Three lights for a night portrait", format: "carousel", platforms: ["instagram", "facebook"], daysAgo: 20, hour: 13, angle: "teach_one_thing", hook: "Key, edge, practical — that's the whole recipe." },
  { title: "Sixty years later: restoring a 1962 wedding film", format: "reel", platforms: ["instagram", "facebook", "x"], daysAgo: 17, hour: 20, angle: "pov_story", hook: "They hadn't seen this footage since 1962." },
  { title: "What a two-minute brand film really costs", format: "post", platforms: ["linkedin", "x"], daysAgo: 14, hour: 9, angle: "founder_voice", hook: "Most of the budget never appears on screen." },
  { title: "Alexa 65 on a gimbal, in a corridor", format: "reel", platforms: ["instagram", "x"], daysAgo: 10, hour: 19, angle: "behind_the_scenes", hook: "Thirty kilos, one corridor, zero cuts." },
  { title: "The frame we almost didn't shoot", format: "post", platforms: ["instagram", "facebook"], daysAgo: 6, hour: 18, angle: "pov_story", hook: "Blue hour lasted four minutes that night." },
  { title: "Myth: you need a big crew for cinema", format: "reel", platforms: ["instagram", "facebook", "linkedin"], daysAgo: 3, hour: 19, angle: "myth_vs_reality", hook: "Three people made this. Here's how." },
];

const AURUM_POSTS: PastPost[] = [
  { title: "Oud Nuit — the pour, in slow motion", format: "reel", platforms: ["instagram", "facebook"], daysAgo: 25, hour: 20, angle: "surreal_hook", hook: "Ink-dark oud meets cold glass." },
  { title: "Notes, explained: top, heart, base", format: "carousel", platforms: ["instagram", "linkedin"], daysAgo: 19, hour: 12, angle: "teach_one_thing", hook: "Why the first spray lies to you." },
  { title: "Inside the atelier at 6am", format: "reel", platforms: ["instagram", "facebook"], daysAgo: 12, hour: 19, angle: "behind_the_scenes", hook: "Before the shop opens, the nose works." },
  { title: "Gift guide: one scent per person", format: "carousel", platforms: ["instagram", "facebook"], daysAgo: 7, hour: 13, angle: "social_proof", hook: "Six people, six signatures." },
  { title: "Why we still bottle by hand", format: "post", platforms: ["linkedin"], daysAgo: 4, hour: 9, angle: "founder_voice", hook: "Every bottle passes through four pairs of hands." },
];

function captionsFor(p: PastPost, tags: string): Record<Platform, string> {
  return {
    instagram: `${p.hook}\n\n${p.title}.\n\n${tags}`,
    facebook: `${p.hook} ${p.title}.`,
    linkedin: `${p.hook}\n\n${p.title} — what it took and what we learned.`,
    x: `${p.hook}`.slice(0, 270),
  };
}

async function backfillAccounts(clientId: string, tz: string): Promise<void> {
  const db = await getDb();
  const conns = await db.select().from(connections).where(eq(connections.clientId, clientId));
  const today = startOfLocalDay(new Date(), tz);
  for (const conn of conns) {
    if (conn.platform === "metricool") continue;
    const platform = conn.platform as Platform;
    const adapter = demoAdapter(platform);
    const ctx = toCtx(conn);
    for (let d = HISTORY_DAYS; d >= 1; d--) {
      const dayStart = addLocalDays(today, -d, tz);
      const metrics = await adapter.accountMetrics(ctx, dayStart, addLocalDays(dayStart, 1, tz));
      await db
        .insert(kpiSnapshots)
        .values({ id: newId("kpi"), clientId, platform, date: localDateKey(dayStart, tz), metrics })
        .onConflictDoNothing();
    }
    const audience = await adapter.audience(ctx);
    if (audience) await db.insert(audienceSnapshots).values({ id: newId("aud"), clientId, platform, data: audience, capturedAt: addLocalDays(today, -2, tz) });
  }
}

async function publishedHistory(clientId: string, tz: string, posts: PastPost[], tags: string): Promise<void> {
  const db = await getDb();
  const conns = await db.select().from(connections).where(eq(connections.clientId, clientId));
  const followersOf = (p: Platform) => Number(conns.find((c) => c.platform === p)?.meta.followers ?? 4200);
  for (const p of posts) {
    const id = newId("cnt");
    const at = atLocalTime(addLocalDays(startOfLocalDay(new Date(), tz), -p.daysAgo, tz), p.hour, 0, tz);
    const perPlatform: PostMetrics[] = [];
    const pubs = p.platforms.map((platform) => {
      const externalId = `demo_${platform}_${id.slice(-10)}`;
      const metrics = demoPostMetrics(platform, { externalId, publishedAt: at, format: p.format }, followersOf(platform));
      perPlatform.push(metrics);
      return {
        id: newId("pub"),
        contentId: id,
        clientId,
        platform,
        status: "published" as const,
        scheduledAt: at,
        publishedAt: at,
        externalId,
        caption: captionsFor(p, tags)[platform],
        metrics,
        metricsUpdatedAt: new Date(),
        checkpoints: Object.fromEntries((["h6", "h24", "h72", "d7"] as const).filter((c, i) => p.daysAgo * 24 >= [6, 24, 72, 168][i]).map((c) => [c, new Date().toISOString()])),
      };
    });
    const total: PostMetrics = {};
    for (const m of perPlatform) for (const [k, v] of Object.entries(m)) if (typeof v === "number" && k !== "retention3s" && k !== "avgWatchSec") total[k as keyof PostMetrics] = ((total[k as keyof PostMetrics] as number) ?? 0) + v;
    await db.insert(contentItems).values({
      id,
      clientId,
      title: p.title,
      angle: p.angle,
      format: p.format,
      platforms: p.platforms,
      status: p.daysAgo >= 7 ? "analyzed" : "live",
      hook: p.hook,
      rationale: "Sample post (demo data).",
      captions: captionsFor(p, tags),
      scheduledAt: at,
      performance: { ...total, engagementRate: engagementRate(total), updatedAt: new Date().toISOString() },
      createdAt: new Date(at.getTime() - 3 * 86_400_000),
      updatedAt: at,
    });
    await db.insert(publications).values(pubs);
  }
}

/** Set a goal that started GOAL_AGE_DAYS ago with a target chosen so pacing tells a story. */
async function goalWithHistory(clientId: string, input: { statement: (target: number) => string; kpi: "followers" | "link_clicks"; platform: Platform | null; ratio: number }): Promise<void> {
  const db = await getDb();
  const rows = await db.select().from(kpiSnapshots).where(eq(kpiSnapshots.clientId, clientId));
  const start = new Date(Date.now() - GOAL_AGE_DAYS * 86_400_000);
  const byDate = new Map<string, number>();
  for (const r of rows) {
    if (input.platform && r.platform !== input.platform) continue;
    const v = kpiValueFromAccount(input.kpi, r.metrics);
    if (v !== undefined) byDate.set(r.date, (byDate.get(r.date) ?? 0) + v);
  }
  const series = [...byDate.entries()].map(([d, v]) => ({ date: new Date(`${d}T12:00:00Z`), value: v })).sort((a, b) => a.date.getTime() - b.date.getTime());
  const before = [...series].reverse().find((s) => s.date < start) ?? series[0];
  const inWindow = series.filter((s) => s.date >= start);
  let target: number;
  let baseline: number | null;
  if (KPI_AGGREGATION[input.kpi] === "level") {
    baseline = before?.value ?? 0;
    const gain = (inWindow.at(-1)?.value ?? baseline) - baseline;
    // Expected gain after GOAL_AGE_DAYS on a straight path = (target - baseline) × age / length.
    target = Math.round((baseline + (gain / input.ratio) * (GOAL_LENGTH_DAYS / GOAL_AGE_DAYS)) / 50) * 50;
  } else {
    baseline = null;
    const sum = inWindow.reduce((a, s) => a + s.value, 0);
    target = Math.round(((sum / input.ratio) * (GOAL_LENGTH_DAYS / GOAL_AGE_DAYS)) / 100) * 100;
  }
  await setGoal(clientId, {
    statement: input.statement(target),
    kpi: input.kpi,
    platform: input.platform,
    target,
    baseline,
    startDate: start,
    deadline: new Date(start.getTime() + GOAL_LENGTH_DAYS * 86_400_000),
  });
  await db.update(goals).set({ createdAt: start }).where(eq(goals.clientId, clientId));
}

export async function seedDemo(opts: { log?: (msg: string) => void } = {}): Promise<{ seeded: boolean; clientIds: string[] }> {
  const say = opts.log ?? (() => undefined);
  const db = await getDb();
  if ((await db.select({ id: clients.id }).from(clients).limit(1)).length) return { seeded: false, clientIds: [] };
  const tz = config().agencyTimezone;

  say("Creating sample clients…");
  const luxi = await createClient({
    name: "Luxi Capture (sample)",
    timezone: tz,
    languages: ["en", "fa"],
    industry: "Cinematic film production",
    brief: {
      positioning: "Cinema-grade wedding, brand and restoration films, shot like features — for couples and brands who care how it feels, not just how it looks.",
      services: "Wedding films, brand films and commercials, archival film restoration, colour grading.",
      voice: "Warm, precise, quietly confident. Speaks like a cinematographer: concrete about light, lenses and moments. Never salesy, never hype words.",
      audience: "Couples planning premium weddings (28–40), marketing leads at fashion, beauty and hospitality brands, and families with old film reels.",
      pillars: ["Behind the frame", "Before / after grade", "Stories from the set", "Craft explained in one idea"],
      visualGrammar: "Shot on ARRI Alexa 65 with vintage primes, Kodak Vision3 500T look, practical light, deep blacks, warm skin. Real places and people. No CGI, no cheap effects.",
      guardrails: ["No CGI or cheap effects", "Never quote prices in public replies", "Memorial and restoration work only with family consent"],
      ctas: ["DM us your date", "Book a consultation — link in bio"],
      hashtags: ["#luxicapture", "#cinematicwedding", "#filmmaking", "#colorgrading", "#weddingfilm", "#brandfilm"],
      competitors: [],
      notes: "Sample client created by demo mode.",
    },
  });
  const aurum = await createClient({
    name: "Aurum Atelier (sample)",
    timezone: tz,
    languages: ["en"],
    industry: "Niche fragrance house",
    brief: {
      positioning: "Small-batch niche fragrances built around oud and resins, made by hand.",
      services: "Signature fragrances, discovery sets, private blending sessions.",
      voice: "Sensory, unhurried, specific about materials. Short sentences. Never generic luxury clichés.",
      audience: "Fragrance enthusiasts 25–45 who buy niche over designer; gift buyers in Q4.",
      pillars: ["Materials up close", "The atelier at work", "How to wear a scent", "Gifting"],
      visualGrammar: "Macro textures, cold glass and warm amber light, slow motion pours, dark backgrounds, no stock imagery.",
      guardrails: ["No health or longevity claims", "No comparisons with named brands"],
      ctas: ["Order the discovery set", "Book a blending session"],
      hashtags: ["#nichefragrance", "#oud", "#perfumelover", "#aurumatelier"],
      competitors: [],
      notes: "Sample client created by demo mode.",
    },
  });

  say("Connecting simulated accounts…");
  await connectDemoAccounts(luxi, [...PLATFORMS], 4200);
  await connectDemoAccounts(aurum, ["instagram", "facebook", "linkedin"], 12800);

  say("Backfilling 45 days of account history…");
  await backfillAccounts(luxi, tz);
  await backfillAccounts(aurum, tz);

  say("Adding a month of published posts with metrics…");
  await publishedHistory(luxi, tz, LUXI_POSTS, "#luxicapture #cinematicwedding #filmmaking");
  await publishedHistory(aurum, tz, AURUM_POSTS, "#nichefragrance #oud #aurumatelier");

  say("Setting goals…");
  await goalWithHistory(luxi, { statement: (t) => `Grow Instagram to ${t.toLocaleString("en-US")} followers`, kpi: "followers", platform: "instagram", ratio: 0.78 });
  await goalWithHistory(aurum, { statement: (t) => `${t.toLocaleString("en-US")} link clicks this quarter`, kpi: "link_clicks", platform: null, ratio: 1.1 });
  await updateGoal(luxi, "Luxi Capture (sample)");
  await updateGoal(aurum, "Aurum Atelier (sample)");

  const [luxiGoal] = await db.select().from(goals).where(eq(goals.clientId, luxi));
  await db.insert(experiments).values({
    id: newId("exp"),
    clientId: luxi,
    goalId: luxiGoal?.id ?? null,
    kind: "major",
    bottleneck: "hook",
    lever: "Cold opens",
    finding: "Reels lose most viewers in the first two seconds while saves per viewer are healthy.",
    change: "Open every reel on motion — the most striking frame first, no logo or title card — for the next six reels.",
    expected: "3-second hold up from ~45% to 55%+, which should lift reach and follows.",
    metric: "retention3s",
    baselineValue: 0.45,
    status: "running",
    startedAt: new Date(Date.now() - 5 * 86_400_000),
    reviewOn: new Date(Date.now() + 9 * 86_400_000),
  });
  await db.insert(insights).values([
    { id: newId("ins"), clientId: luxi, text: "Restoration and family-story reels reach about 2× further than equipment reels.", evidence: "Sample insight (demo data).", confidence: "medium", source: "analysis" },
    { id: newId("ins"), clientId: luxi, text: "Carousels that teach one lighting idea earn the most saves per viewer.", evidence: "Sample insight (demo data).", confidence: "medium", source: "analysis" },
    { id: newId("ins"), clientId: aurum, text: "Slow-motion material close-ups outperform lifestyle shots on Instagram.", evidence: "Sample insight (demo data).", confidence: "low", source: "analysis" },
  ]);

  say("Answering recent comments…");
  await syncCommunity().catch(() => undefined);

  say("Planning a new scenario…");
  const scenarioId = await createScenario({
    clientId: luxi,
    text: "We restored a 1970s Super 8 reel for a family in time for their parents' 50th anniversary. Show the grain, the faces, and the moment they watched it together — and invite people with old reels to get in touch.",
    formats: ["reel", "carousel", "story"],
    platforms: [],
    count: 3,
  });
  await planScenarioJob({ scenarioId });
  const planned = await db.select().from(contentItems).where(eq(contentItems.scenarioId, scenarioId));
  const pick = planned.find((i) => i.format === "reel") ?? planned[0];
  if (pick) await greenlight(pick.id);

  await logRun({ kind: "onboard", summary: "Demo data loaded: two sample clients with simulated accounts, history and a fresh scenario." });
  return { seeded: true, clientIds: [luxi, aurum] };
}
