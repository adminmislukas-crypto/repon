# repon — exact commands

Ports: core-api = `$PORT` from `.env` (default 3000), usuario-mobile web = 8091,
proveedor-mobile web = 8092, Supabase API = 54321, Supabase DB = 54322
(`supabase/config.toml`). Artifact dir: `.dev/repon/` at repo root — `mkdir -p
.dev/repon` before writing logs.

## Docker check (before `supabase start`)

```bash
docker ps >/dev/null 2>&1 || { echo "Docker Desktop not running/paused — resume it manually (Whale menu → Resume), then re-run /repon up"; exit 1; }
```

## Supabase

```bash
supabase start                                    # idempotent, no-op if already running
supabase status -o env > .dev/repon/supabase.env   # inspect actual keys before trusting names below
supabase stop                                      # down / reset
supabase db reset                                  # reset only — wipes local Postgres, reapplies migrations + supabase/seed.sql
```

`supabase status -o env` is expected to expose `API_URL`, `DB_URL`, `JWT_SECRET`,
`SERVICE_ROLE_KEY`. CLI output can vary by version — confirm the actual key
names in `.dev/repon/supabase.env` before writing `.env`; never assume.

## Bootstrap services/core-api/.env (only if missing)

Copy `services/core-api/.env.example` to `services/core-api/.env`, then fill:

```
SUPABASE_URL=<API_URL>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>
# NOT <DB_URL> as-is: DB_URL from status connects as `postgres` (superuser).
# core-api must authenticate as `authenticator` (member of service_role) —
# see .env.example's own comment block for why. Port matches DB_URL's port.
DATABASE_URL=postgresql://authenticator:postgres@127.0.0.1:54322/postgres
AUTH_JWT_MODE=hs256
SUPABASE_JWT_SECRET=<JWT_SECRET>
AUTH_JWT_ISSUER=<API_URL>/auth/v1
AUTH_JWT_AUDIENCE=authenticated
NODE_ENV=development
PORT=3000
```

## core-api (dev)

```bash
cd services/core-api
nohup pnpm start:dev > ../../.dev/repon/core-api.log 2>&1 &
disown
```

Readiness: poll for either `Nest application successfully started` in the log,
or `curl -sf http://localhost:3000/api/docs -o /dev/null` returning exit 0, up
to ~60s. On timeout, report failure with `tail -20 .dev/repon/core-api.log`.

## Expo web (usuario-mobile / proveedor-mobile)

```bash
cd apps/usuario-mobile   # or apps/proveedor-mobile for the 8092 instance
nohup env EXPO_USE_METRO_WORKSPACE_ROOT=1 npx expo start --web --port 8091 --clear \
  > ../../.dev/repon/usuario-mobile.log 2>&1 &
disown
```

(proveedor-mobile: `--port 8092`, log `proveedor-mobile.log`.)

Readiness: poll the log for `Waiting on http`, then
`curl -s -o /dev/null -w '%{http_code}' http://localhost:<port>/` until it
returns `200`, up to ~60s. A `500` whose body contains `_expo-static-error` is
a real module-resolution failure, not "still booting" — report it immediately,
don't keep polling past that.

## Stopping a service by port

```bash
PIDS=$(lsof -ti:<port>)
[ -n "$PIDS" ] && kill $PIDS
sleep 2
lsof -ti:<port> >/dev/null 2>&1 && kill -9 $(lsof -ti:<port>)   # still occupied → force
```

## Cache clear (reset only)

```bash
rm -rf apps/usuario-mobile/.expo apps/proveedor-mobile/.expo
rm -rf services/core-api/dist services/core-api/*.tsbuildinfo
```
