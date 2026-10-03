# Luxi Social Agent — production image (web app + in-process agent worker + ffmpeg renderer).
#   docker build -t luxi-agent .
#   docker run -p 3000:3000 --env-file .env -v luxi-data:/data luxi-agent
# or `docker compose up -d` with the bundled Postgres (see docker-compose.yml).

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 NEXT_OUTPUT=standalone
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 DATA_DIR=/data
# ffmpeg (with libass/harfbuzz/fribidi for Farsi captions) renders the motion videos.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates tini \
  && rm -rf /var/lib/apt/lists/* \
  && ffmpeg -hide_banner -h filter=xfade | grep -q zoomin \
  && groupadd --system app && useradd --system --gid app --home-dir /app app \
  && mkdir -p /data && chown app:app /data
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "server.js"]
