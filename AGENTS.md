# Working on this repository

Luxi Social Agent: a Next.js 16 PWA plus an in-process job worker that plans, produces, publishes,
measures and pivots social content for agency clients. User-facing docs are in `README.md`,
`docs/SETUP.md` and `docs/AGENT.md`.

## Commands

```bash
npm run dev          # app + worker on :3000 (demo mode without ANTHROPIC_API_KEY)
npm test             # vitest; needs ffmpeg on PATH (real renders run in tests)
npm run typecheck    # tsc --noEmit
npm run build        # next build (type-checks too)
npm run db:generate  # after editing src/server/db/schema.ts → new SQL migration in drizzle/
```

Run `npm run typecheck && npm test` before committing. The full suite takes about two minutes
because of the ffmpeg renders and the end-to-end demo pipeline.

## Layout and rules

- `src/domain/`: pure functions and types (lifecycle, caption rules, scheduling, analytics/pacing,
  quotes, time zones, cron). No I/O. Every rule the agent follows that can be computed belongs
  here, with a unit test in `tests/domain/`.
- `src/agent/`: Claude roles. Each call goes through `LLM.structured()` with a zod schema and a
  `demo()` stand-in, so demo mode and tests never need the API. Prompts are in `prompts.ts`. The
  model never does arithmetic; numbers are computed in code and passed in.
- `src/server/pipeline/`: job handlers (plan, produce, publish, measure, analyze, community, watch).
  Register new job types in `src/server/jobs/registry.ts`; recurring ones in `jobs/scheduler.ts`.
- `src/server/platforms/`: one adapter per platform implementing `PlatformAdapter` (`types.ts`), plus
  `demo.ts`. HTTP goes through `platformFetch` so tests can fake it (`tests/server/platforms.test.ts`).
- `src/server/services/`: state changes initiated by a person (green-light, approve, connect…).
  Lifecycle moves must go through `assertTransition`; the human gates are enforced here.
- `src/app/`: screens (`(app)/`), server actions (`actions.ts`), API routes (`api/`). Every page,
  action and route that touches data calls `requireUser()` (`src/server/auth/dal.ts`). The proxy
  (`src/proxy.ts`) is only an optimistic redirect.
- `src/server/queries.ts`: read models for the screens. Keep pages free of raw queries.
- `src/components/`: UI. Client components are marked `"use client"`. Don't export plain values
  from them for server use; shared constants go in a non-client module (see `nav-items.ts`).

## Conventions

- Next.js 16: `params`/`searchParams` are promises, middleware is `src/proxy.ts`, and the worker
  starts from `src/instrumentation.ts`.
- Config comes only from `config()` in `src/server/config.ts` (zod-validated env, parsed lazily).
  Add new variables there and in `.env.example`.
- Secrets and tokens are encrypted with `encrypt()` before they touch the database. Never log them.
- Times are stored as UTC `timestamptz`. Convert at the edges with `src/domain/time.ts` using the
  client's IANA time zone.
- Theme colours are CSS variables in `src/app/globals.css` (dark default, light via
  `prefers-color-scheme`). Chart colours use the `--viz-*` tokens.
- Media URLs are absolute (`APP_URL/api/media/…`). In the UI, pass them through `mediaSrc()`.
- Playbooks in `/playbooks` are only seeds. The live copies are in the `knowledge` table and are
  edited in the app.

## Tests

- `tests/domain/`: pure rules.
- `tests/server/platforms.test.ts`: adapters against a fake fetch.
- `tests/media/render.test.ts`: real ffmpeg renders; output goes to `data/test/`.
- `tests/server/pipeline.e2e.test.ts`: the whole loop in demo mode on an in-memory PGlite database.
- `tests/server/routes.test.ts`, `tests/server/seed.test.ts`: API routes and sample data.

Use `useInMemoryDbForTests()` for database tests and `resetConfigForTests()` after changing
`process.env`.
