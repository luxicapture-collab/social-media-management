# Going live

This guide takes the agent from demo mode to real client accounts. Do the steps in order; each one
can be tested on its own. Every key goes in `.env` (copy `.env.example`). The **Settings →
Integrations** screen shows what's connected.

- [1. Basics: address, login, secrets](#1-basics-address-login-secrets)
- [2. Claude](#2-claude)
- [3. Higgsfield and ElevenLabs](#3-higgsfield-and-elevenlabs)
- [4. Media storage](#4-media-storage)
- [5. Meta: Instagram and Facebook](#5-meta-instagram-and-facebook)
- [6. LinkedIn](#6-linkedin)
- [7. X](#7-x)
- [8. Metricool (optional)](#8-metricool-optional)
- [9. Notifications: phone, desktop, Telegram](#9-notifications-phone-desktop-telegram)
- [10. Deployment](#10-deployment)
- [11. Security checklist](#11-security-checklist)

## 1. Basics: address, login, secrets

The app needs a **public HTTPS address**. OAuth providers redirect to it, Meta sends webhooks to it,
phones need it to install the app and receive push, and Instagram downloads post media from it.

| Variable | Value |
|---|---|
| `APP_URL` | e.g. `https://agent.yourdomain.com` (no trailing slash) |
| `ADMIN_EMAIL` | the address you sign in with |
| `ADMIN_PASSWORD_HASH` | output of `npm run hash-password -- 'a long passphrase'` |
| `SESSION_SECRET`, `ENCRYPTION_KEY` | two different random strings, e.g. `openssl rand -base64 48` |
| `AGENCY_TIMEZONE` | your IANA zone, e.g. `Asia/Dubai`. Daily checks and quiet hours run on it. |
| `AGENCY_NAME`, `OWNER_NAME` | used in the agent's voice and in the app |

`ENCRYPTION_KEY` protects every saved platform token (AES-256-GCM). Keep it stable: if it changes,
reconnect the accounts.

For testing from your own computer before you have a server, a tunnel gives you a public HTTPS URL
for `localhost:3000`, for example `cloudflared tunnel --url http://localhost:3000`. Set `APP_URL` to
the tunnel address.

## 2. Claude

1. Create an API key at <https://console.anthropic.com> → API keys.
2. Set `ANTHROPIC_API_KEY`. With `DEMO_MODE=auto` (the default), demo mode turns off as soon as the
   key is present.
3. `CLAUDE_MODEL` defaults to `claude-opus-5-5`. Planning and analysis use extended thinking with
   high effort, replies and chat use lower effort, and system prompts are cached to cut cost.
4. `CLAUDE_FALLBACKS=default` lets a declined request be retried on the platform's fallback model.
   Set it to `off` to disable that.

Cost per task (planning, critique, captions, analysis, replies, chat, watch) is shown under
**Settings → Usage**.

## 3. Higgsfield and ElevenLabs

**Higgsfield** (images and video):

1. Create an API key pair at <https://cloud.higgsfield.ai> → API keys.
2. Set `HIGGSFIELD_CREDENTIALS=KEY_ID:KEY_SECRET` (both parts, separated by a colon).
3. Open **Settings → Generation models**. Each role (`video.cinematic`, `video.fast`,
   `image.hero`, `image.fast`…) maps to an endpoint and its input field names. The defaults follow
   Higgsfield's published API. Run one cheap test piece and adjust any endpoint your account names
   differently; this needs no code change.
4. Update **Settings → Price table** to your plan's real credit costs. Quotes are computed from it,
   and production stops for re-approval if real spend runs more than 15% over a quote.

**ElevenLabs** (voice, music, sound effects):

1. Create an API key at <https://elevenlabs.io/app/settings/api-keys> with access to text to speech,
   music and sound effects.
2. Set `ELEVENLABS_API_KEY`. Voiceovers use `eleven_v3`, which speaks Farsi as well as English,
   with word timestamps for the burned-in captions.
3. Optional: `ELEVENLABS_DEFAULT_VOICE_ID` to always use one voice. Otherwise the director picks a
   voice from your library to fit each piece's casting note.

**ffmpeg** must be installed on the server (`apt install ffmpeg`; the Docker image includes it). It
needs libass with HarfBuzz and FriBiDi for Farsi captions, which standard Debian and Ubuntu builds
have. The renderer uses the fonts bundled in `assets/fonts`.

## 4. Media storage

Rendered videos and images must be reachable at a public URL, because Instagram and Facebook fetch
media from a URL rather than accepting uploads.

- **Local (default):** files live in `DATA_DIR/media` and are served at `APP_URL/api/media/…` with
  byte-range support. This works as long as `APP_URL` is public.
- **S3-compatible bucket:** Cloudflare R2, AWS S3, Supabase Storage and others. Make the bucket (or a
  custom domain in front of it) publicly readable, then set:

  ```
  STORAGE_DRIVER=s3
  S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
  S3_REGION=auto
  S3_BUCKET=luxi-media
  S3_ACCESS_KEY_ID=…
  S3_SECRET_ACCESS_KEY=…
  S3_PUBLIC_BASE_URL=https://media.yourdomain.com
  ```

Media keys contain random ids and nothing lists them, but anyone with a link can open that file.

## 5. Meta: Instagram and Facebook

Each client's Instagram must be a **Professional account** (Business or Creator) linked to their
**Facebook Page**.

1. Go to <https://developers.facebook.com/apps> → **Create app** → type **Business**.
2. Add the products **Facebook Login for Business**, **Instagram** (API setup with Facebook Login) and
   **Webhooks**.
3. In Facebook Login → Settings, add the valid OAuth redirect URI
   `APP_URL/api/connect/meta/callback`.
4. Copy **App ID** and **App secret** into `META_APP_ID` and `META_APP_SECRET`. Optional: if you
   create a Facebook Login for Business configuration, put its id in `META_LOGIN_CONFIG_ID`.
5. The app asks for these permissions: `pages_show_list`, `pages_read_engagement`,
   `pages_manage_posts`, `pages_manage_engagement`, `pages_read_user_content`, `pages_messaging`,
   `read_insights`, `business_management`, `instagram_basic`, `instagram_content_publish`,
   `instagram_manage_comments`, `instagram_manage_insights`, `instagram_manage_messages`.
6. **Access level:** while the app is in development mode it works for Pages and Instagram accounts
   that you, as an app admin, manage. That usually covers an agency that manages client assets
   through Meta Business Suite with Page access granted to you. To connect accounts managed by
   other people, request Advanced Access for those permissions through App Review.
7. **Webhooks** (comments and DMs answered in seconds instead of the 10-minute poll): set
   `META_WEBHOOK_VERIFY_TOKEN` to any random string. In the app's Webhooks product, subscribe:
   - **Page**: `feed` and `messages`
   - **Instagram**: `comments`, `mentions` and `messages`

   Use callback URL `APP_URL/api/webhooks/meta` and the same verify token. Event signatures are
   checked against the app secret.

Then open a client → **Accounts** → **Connect Instagram + Facebook**. Sign in, and if your login
manages several Pages, pick the client's.

**Limits to know:** Instagram allows 100 API-published posts per account per 24 hours, and Reels
must meet its video specs. The renderer outputs 1080×1920 H.264/AAC, which complies. Story stickers
can't be added through the API: stories that plan stickers are marked **post by hand**, and the
agent tracks them after you tap **Mark as posted**.

## 6. LinkedIn

1. Create an app at <https://www.linkedin.com/developers/apps> and associate it with your company
   Page (the agency's Page is fine).
2. Under **Products**, request the **Community Management API**. LinkedIn reviews this; approval is
   needed to post as organizations and read their analytics.
3. Under **Auth**, add the redirect URL `APP_URL/api/connect/linkedin/callback`.
4. Set `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`. The default scopes are
   `r_organization_social w_organization_social rw_organization_admin w_member_social openid profile`.
5. The person connecting must be an **administrator** (or content admin) of the client's LinkedIn
   Page. Open a client → **Connect LinkedIn page** → pick the Page.

`LINKEDIN_API_VERSION` (YYYYMM) pins the API version. LinkedIn retires versions after about a year,
and the daily watch alerts you when a newer one matters.

## 7. X

1. At <https://developer.x.com>, create a project and app, and add credits to your account. The X
   API is pay-per-use.
2. Under **User authentication settings**, enable **OAuth 2.0**, type **Web App**, with callback URL
   `APP_URL/api/connect/x/callback` and your website URL.
3. Copy the **OAuth 2.0 Client ID** and **Client Secret** into `X_CLIENT_ID` and `X_CLIENT_SECRET`.
4. Default scopes: `tweet.read tweet.write users.read offline.access media.write dm.read dm.write`.
   `offline.access` lets the agent refresh tokens on its own.

The agent keeps X posts short, avoids links in the post body (they cost more and reach less) and
tracks API spend.

## 8. Metricool (optional)

Metricool can publish on the agent's behalf. This helps while Meta or LinkedIn app review is
pending, or when a client already uses Metricool.

1. In Metricool → account settings → API, copy your user token and user id into
   `METRICOOL_USER_TOKEN` and `METRICOOL_USER_ID`.
2. On each client's page, open **Metricool**, enter the brand id (`blogId`) and save.
3. Switch any platform's route from **Direct API** to **Via Metricool**. Metrics are still read
   from the platform where a direct connection exists.

## 9. Notifications: phone, desktop, Telegram

**Push (Web Push):**

1. Run `npm run vapid` and paste the three lines into `.env`, setting `VAPID_SUBJECT` to your
   email. Restart the app.
2. On each device, open the app → **Settings** → **Enable notifications on this device**.
   - iPhone/iPad: install to the Home Screen first (Safari → Share → Add to Home Screen) and open it
     from there. Requires iOS 16.4+.
   - Android, Mac and Windows: works in Chrome and Edge, installed or not.
3. Choose what reaches you in **Settings → Notifications**: importance level, quiet hours and the
   morning brief. High-importance alerts ignore quiet hours.

**Telegram (optional):** create a bot with [@BotFather](https://t.me/BotFather), send it a message,
then get your chat id from `https://api.telegram.org/bot<token>/getUpdates`. Set
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`.

## 10. Deployment

### Docker Compose (recommended)

```bash
cp .env.example .env   # fill in sections 1–9
echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
docker compose up -d
```

This starts the app (web, agent worker and renderer in one container) and Postgres. Data lives in
the `media` and `pg` volumes. Put HTTPS in front, for example with Caddy:

```
agent.yourdomain.com {
  reverse_proxy localhost:3000
}
```

Back up both volumes, or run `pg_dump` plus a copy of the media volume, or use S3 storage for media.

### Plain Node server

```bash
npm ci
npm run build
npm start          # PORT=3000 by default
```

Without `DATABASE_URL`, the embedded PGlite database lives in `DATA_DIR/pglite`. It's fine for a
single instance, but only one process may open it, so keep `RUN_WORKER=in-process`. With Postgres,
you can run the worker separately: set `RUN_WORKER=off` on the web app and run `npm run worker`
as a second process.

### Cron instead of a background worker

On hosts that can't keep a process running, set `RUN_WORKER=off` and a `CRON_SECRET`, then call the
tick endpoint every minute:

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://agent.yourdomain.com/api/cron/tick
```

Each tick fires due schedules (publishing, metrics, the daily watch…) and runs queued jobs for up to
about 50 seconds. Video rendering is CPU-heavy, so prefer a small always-on server when you produce
video regularly.

### Schedules

These run automatically. You can pause one or run it immediately under **Settings → Agent schedule**.

| Routine | When | What |
|---|---|---|
| publish-due | every minute | publish posts whose time has come |
| advance-production | every minute | poll renders, assemble finished cuts |
| sweep, community | every 10 min | pick up pending work; read and answer comments and DMs |
| post-metrics | hourly | 6 h / 24 h / 72 h / 7 d post metrics |
| daily-kpis | 06:30 agency time | account KPIs, audience, goal pace, anomalies |
| daily-watch | 07:00 agency time | platform/tool changes, account health, credits, morning brief |
| weekly-review | Monday 08:00 | diagnosis, pivots, experiment results, weekly report |
| housekeeping | 03:40 UTC | prune logs, expire connect sessions, refresh tokens |

## 11. Security checklist

- Use `ADMIN_PASSWORD_HASH`, not a plain password, and a long passphrase. Sign-in locks for 10
  minutes after 8 failed attempts.
- Set `SESSION_SECRET` and `ENCRYPTION_KEY` to long random values and keep `.env` out of version
  control (it's git-ignored). In production the app refuses to start without them.
- Serve only over HTTPS. The session cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` when
  `APP_URL` is HTTPS.
- Platform tokens are encrypted at rest and never shown in the UI. Disconnecting an account deletes
  its tokens.
- Meta webhooks are signature-checked, and the cron endpoint requires the bearer secret.
- Public routes are limited to sign-in, media files, webhooks, the cron tick (secret-protected),
  health, and the PWA files. Everything else requires your session.
