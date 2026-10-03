# How the agent works

The agent is a set of Claude roles driven by a job queue. Each role has one job, reads the client's
brief, goal, recent performance and the relevant playbooks, and returns **structured output** that
the code validates before anything happens. Every number is computed by the code; the model never
does arithmetic. Spending money or publishing always passes a human gate.

## The loop

```
 scenario ─▶ plan ─▶ concept ══▶ GREEN-LIGHT ══▶ produce ─▶ cut ══▶ APPROVE ══▶ schedule ─▶ publish
                        ▲             (you)                              (you)                 │
                        │                                                                      ▼
                     re-plan ◀── pivot ◀── weekly review / goal behind ◀── KPIs ◀── measure ◀──┘
```

| Status | Owner | Moves on when |
|---|---|---|
| `concept` | you | you green-light (spend starts), ask for changes, or drop it |
| `greenlit` → `producing` | agent | generation and assembly finish (or fail, with nothing more spent) |
| `review` | you | you approve the cut with final captions and time, or send it back |
| `revise` | agent | the concept or cut is reworked from your note and returns to you |
| `approved` → `scheduled` | agent | per-platform posts are created at their slots |
| `live` → `analyzed` | agent | metrics arrive at 6 h, 24 h, 72 h and 7 days |

The transitions live in `src/domain/lifecycle.ts`. Server code rejects any move that isn't allowed,
and the two gates can only be crossed by your actions.

## The roles

| Role | Runs | Produces |
|---|---|---|
| **Strategist** | on every scenario | ≥ 5 scored angles, then concepts: title, angle, format, platforms, hook, timed beats, rationale, four captions, story frames, first comments, proposed time and a full production plan |
| **Critic** | after planning | a 0–10 score with notes per concept; anything below 8 is rewritten once |
| **Copy fixer** | when a caption breaks a platform rule | a corrected caption, at most two rounds |
| **Director** | on your revision notes | a reworked concept or production plan that keeps what you didn't mention |
| **Analyst** | daily when the goal is behind, and every Monday | goal read, bottleneck, experiment decisions, one new experiment, micro-adjustments, insights, re-plan direction |
| **Community** | for every comment and DM | category, language, action (reply / hide / escalate / ignore) and the reply text |
| **Watcher** | on every changed source in the daily watch | relevant?, importance, summary, suggested action, optional playbook edit |
| **Chat** | when you ask | answers and actions through tools (list clients, performance, create scenario, set goal, approve…) |

Prompts are in `src/agent/prompts.ts`. Each role's output schema sits next to its code in
`src/agent/`.

## Planning a scenario

1. The client context is assembled: the brief (voice, pillars, guardrails, visual grammar), the goal
   and its pace, the diagnosed bottleneck, running experiments, insights learned so far, the best
   posting hours, and what's already scheduled.
2. The strategist explores at least five angles and scores each for goal fit, novelty, cost and
   platform fit. Concepts are built from the strongest ones and steer toward the current
   bottleneck: weak hooks get stronger cold opens, weak resonance gets more useful content.
3. Captions are validated against `CAPTION_RULES` (length, the "more" fold, hashtags, link policy,
   clichés) and fixed automatically.
4. Each concept gets a **quote** from the price table, covering every generation call, the voice,
   music, AI planning and a contingency.
5. Each concept gets a **slot** in the client's time zone. Learned best hours come first, then
   defaults. The pacing rules apply: at most one reel per platform per day, feed posts at least 4 h
   apart, stories at least 2 h apart.

## Production

After green-light, the production plan becomes generation tasks:

- **Stills** for each shot or frame (Higgsfield image models, or a keyframe for image-to-video).
- **Video** clips (Higgsfield video models), when the plan calls for motion beyond camera moves.
- **Voiceover** with word timestamps, **music** and **sound effects** (ElevenLabs).

Tasks run in parallel and are polled every minute. The quote is re-checked as costs come in, and if
spend would exceed it by more than 15%, production pauses and the concept returns to you with a new
quote. When everything is in, ffmpeg assembles the cut:

- Ken Burns moves on stills and transitions between shots (dissolve, fade, slide, zoom, whip).
- Typography from the house look: a hook card, point overlays and a CTA card, in the bundled fonts
  (Vazirmatn for Farsi).
- Captions timed to each spoken word.
- Music ducked under the voice and loudness normalised to −14 LUFS.
- One render per aspect ratio the platforms need: 9:16 for Instagram and Facebook Reels and
  Stories, 4:5 for X, LinkedIn and feed posts.
- Carousels become numbered stills, plus a PDF document for LinkedIn.

## Publishing

Approving creates one publication per platform, carrying its own caption and media variant. When the
time comes the worker publishes through the platform adapter (`src/server/platforms/`) or Metricool.
Failures retry with backoff. Expired tokens and auth errors mark the connection and alert you.
Stories that need interactive stickers are flagged for you to post by hand. On the direct-API route,
posts with AI-generated visuals get the client's disclosure line.

## Measuring and pacing

- **Post metrics** are collected at 6 h, 24 h, 72 h and 7 days: reach, views, likes, comments,
  shares, saves, clicks, profile visits, follows, and 3-second hold and watch time for video.
  They roll up into each piece's performance.
- **Account KPIs** are collected daily per platform, with audience breakdowns refreshed weekly.
- **Goal pace** is computed against a straight path from the baseline to the target. A level KPI
  (followers) uses the latest reading; a flow KPI (reach, clicks, leads) uses the running total in
  the goal window. Pace is *ahead* at ≥ 105% of the expected gain, *on track* at ≥ 90%, *behind*
  at ≥ 70%, and *off track* below that. A least-squares projection estimates where the goal will
  land.
- **Anomalies** (sudden follower or reach drops) raise a high-importance alert.

## Pivoting toward the goal

When the goal is behind two days running, and every Monday regardless, the analyst runs:

1. **Diagnosis:** recent posts are compared stage by stage with the client's own history, or with
   benchmarks while history is thin, and weighted by what matters for the goal's KPI:
   - **distribution**: reach ÷ followers
   - **hook**: 3-second hold
   - **resonance**: (saves + shares) ÷ reach
   - **conversion**: (profile visits + clicks + follows) ÷ reach

   The weakest weighted stage is the bottleneck.
2. **Experiments:** at most one major experiment per week, each with a finding, a single change, an
   expected result, a metric and a review date. Tagged posts are compared with untagged baseline
   posts. The result is kept, reverted or extended, and becomes an insight.
3. **Micro-adjustments** (posting times, hashtag sets, hook phrasing) are applied automatically if
   the client allows it, otherwise proposed.
4. **Re-plan:** concepts not yet green-lit are reworked around the pivot and come back to you.
5. **Memory:** insights such as "restoration stories reach 2× further than gear reels" are stored
   per client, and the strategist reads them before every plan.

## Community

Every 10 minutes, or within seconds with Meta webhooks, new comments and DMs are pulled and triaged:

- **Routine** (praise, simple questions): answered in the client's voice and the commenter's
  language, specific to what they said.
- **Leads** (price, availability, booking): answered warmly with a next step and never a price,
  then flagged **needs you** for your personal follow-up.
- **Sensitive** (complaints about delivered work, refunds, legal, press, safety, minors, private
  event details): a short holding reply, flagged **needs you** and pushed to your phone.
- **Spam and abuse**: hidden.
- Instagram and Facebook DMs are only answered inside the 24-hour messaging window.

Each client can be set to **auto**, **draft** (the agent writes, you send from the Inbox) or **off**.

## Daily watch and self-update

At 07:00 agency time the watcher:

1. Fetches each source (the Meta Graph and Instagram changelogs, LinkedIn's recent API changes, the X
   changelog, Instagram's creator blog, and the ElevenLabs and Higgsfield docs), keeps only the
   new text, and asks the watcher role whether it matters for this agency's work.
2. Checks every connection's health and token expiry, stuck or failed publications, and generation
   credits.
3. Rates each finding high, medium or info. High findings are pushed immediately; the rest go
   into the morning brief and Alerts.
4. When a change should alter how content is made (a new limit, format, metric name or price), it
   proposes the exact edit to the relevant playbook. Nothing changes until you tap **Apply**.

Sources are listed under Settings → Daily watch sources.

## Tuning it

- **Playbooks** (in the app under Playbooks; seeds in `/playbooks`): the creative grammar, platform
  rules, strategy rules, community policy and watch rubric. This is the main lever. Write what
  you'd tell a new team member.
- **Client brief and autonomy** (each client's page): voice, pillars, guardrails, CTAs, hashtags,
  weekly budget, reply policy, micro-pivot permission, posting cadence, disclosure line.
- **Generation models and prices** (Settings): which endpoint each role uses and what it costs.
- **Code-level rules** (`src/domain/`): caption limits, pacing rules, benchmarks and KPI weights, pace
  thresholds. All are pure functions with tests.

## Demo mode

Without `ANTHROPIC_API_KEY`, every role has a deterministic stand-in (`src/agent/demo.ts`,
`demoTriage`…). The platforms use a simulated adapter with plausible metric curves and sample
comments, and production renders real ffmpeg cuts from generated placeholder stills and music. It
exercises the whole loop end to end without spending anything or posting anywhere. The test suite
runs this way too.
