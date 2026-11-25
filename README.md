# SWELECT Project Control (cluad-track)

Solar EPC & IPP project management, scheduling and project control. Next.js 16 + Supabase, deployed on Vercel.

## Run locally
```bash
npm install
npm run dev        # no Supabase keys = local demo mode (data not saved)
```
Production needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (set in Vercel). Never commit keys.

## Tests, deployment and performance
`npm test` runs the unit and end-to-end tests. See `deploy/README.md` for rate limiting, caching, load balancing,
reverse proxy, API gateway, CI/CD, Docker, Kubernetes, service discovery and the circuit breaker.

## Project passwords
Any project can have a password (key button on the project card, or Project Setup). Locked projects keep their
schedule, progress and history behind the password on the server. Only bcrypt hashes are stored, in the
`swelect_settings` table under `project.passwords`.
