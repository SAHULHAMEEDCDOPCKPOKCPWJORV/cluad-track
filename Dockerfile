# SWELECT Project Control - production image (Next.js standalone server).
# Build:  docker build -t swelect-project-control \
#           --build-arg NEXT_PUBLIC_SUPABASE_URL=https://<project>.supabase.co \
#           --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable key> .
# Run:    docker run -p 3000:3000 --env-file .env.production swelect-project-control
# The NEXT_PUBLIC_* values are public (they are sent to every browser) and are baked in at build time.
# Server secrets (SUPABASE_SERVICE_ROLE_KEY, SESSION_SECRET, ...) are passed only at run time, never baked in.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22-alpine AS build
WORKDIR /app
ARG NEXT_PUBLIC_SUPABASE_URL=""
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY=""
ARG APP_BUILD_ID=""
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    APP_BUILD_ID=$APP_BUILD_ID \
    BUILD_STANDALONE=1 \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN addgroup -S -g 1001 app && adduser -S -u 1001 -G app app
COPY --from=build --chown=app:app /app/.next/standalone ./
COPY --from=build --chown=app:app /app/.next/static ./.next/static
COPY --from=build --chown=app:app /app/public ./public
USER app
EXPOSE 3000
# Liveness: is the server answering? (readiness with a database check: /api/health?ready=1)
HEALTHCHECK --interval=15s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
