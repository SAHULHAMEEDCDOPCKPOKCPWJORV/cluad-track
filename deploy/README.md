# Performance & reliability setup

The live site runs on **Vercel** (https://cluad-track.vercel.app). The Docker, nginx and Kubernetes files
here are for running the same app on your own servers; Vercel does not use them.

| Item | Where | On Vercel (live) | Self-hosted |
|---|---|---|---|
| Rate limiting | `src/proxy.ts` (per server copy) + `src/server/rateLimit.ts` (shared, in the database) | both active | both active + nginx / ingress front-door limits |
| Caching | `next.config.mjs` headers, `src/server/resilience.ts` (TtlCache), `public/sw.js` | active + Vercel CDN | active + nginx static cache |
| Load balancing | — | Vercel spreads requests over function copies | nginx `least_conn` over app containers; Kubernetes Service / ingress |
| Reverse proxy | `deploy/nginx/nginx.conf`, `deploy/k8s/ingress.yaml` | Vercel edge network | nginx / ingress-nginx |
| API gateway | `src/proxy.ts` | active | active |
| CI/CD | `.github/workflows/ci.yml`, Vercel Git integration | tests on every push; Vercel deploys `main` | build image in CI, `kubectl apply -k deploy/k8s` |
| Docker | `Dockerfile`, `docker-compose.yml` | not used | `docker compose up -d --build` |
| Kubernetes | `deploy/k8s/` | not used | Deployment, Service, HPA (3-10 copies), PDB, Ingress |
| Service discovery | — | not needed (fixed service URLs from env) | Docker DNS (`app`), Kubernetes DNS (`swelect-app.swelect.svc`) |
| Circuit breaker | `src/server/resilience.ts` | active on every database call | active |

## Health checks
- `GET /api/health` — the process is up (liveness).
- `GET /api/health?ready=1` — also reaches the database; 503 if not (readiness). Shows the circuit breaker state.

## Self-hosting with Docker
```bash
cp deploy/env.example .env.production   # fill in, never commit
docker compose up -d --build            # 3 app containers + nginx on port 80
docker compose up -d --scale app=5      # more containers; nginx finds them by DNS
```

## Kubernetes
```bash
docker build -t ghcr.io/<you>/swelect-project-control:<tag> . && docker push ghcr.io/<you>/swelect-project-control:<tag>
kubectl create namespace swelect
kubectl -n swelect create secret generic swelect-secrets \
  --from-literal=SUPABASE_SERVICE_ROLE_KEY=... --from-literal=SESSION_SECRET=... --from-literal=CRON_SECRET=...
kubectl apply -k deploy/k8s
```
Set the image name in `deploy/k8s/deployment.yaml` and your domain in `deploy/k8s/ingress.yaml` first.
Needs ingress-nginx, cert-manager and metrics-server in the cluster.

## Tests
```bash
npm run typecheck && npm run build
npm test            # unit tests (circuit breaker, retry, timeout, cache) + end-to-end tests on demo data
```

## Important
- The app trusts the `X-Real-IP` header for rate limiting. Vercel, the nginx config and ingress-nginx set it.
  Do not expose the app containers directly to the internet without one of them in front.
- To stop a failing change from going live, protect `main` on GitHub and require the CI checks.
