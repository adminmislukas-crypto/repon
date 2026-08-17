---
name: repon
description: "Trigger: repon up, repon down, repon reset. Start, stop, or reset the full local dev stack (Supabase, core-api, usuario-mobile, proveedor-mobile) for this repo."
license: Apache-2.0
metadata:
  author: "jpab"
  version: "1.0"
---

## Activation Contract

Load when the user invokes `/repon up`, `/repon down`, or `/repon reset` in this repo (repon-monorepo).

## Hard Rules

- Never report a service as "up" without an actual readiness check (curl 200 or matching log line) — a backgrounded process is not proof it's serving.
- If `docker ps` reports Docker Desktop paused/not running, stop immediately and tell the user to resume it manually (Whale menu → Resume, or open Docker Desktop). Never poll/wait for Docker to come back on its own.
- Before running `supabase db reset` (in `reset`), state explicitly that it wipes local Postgres data and reapplies migrations + seed — never run it silently.
- Discover running services by port (`lsof -ti:<port>`), not by trusting stale PID files — a prior session may have started them.
- `apps/admin-web` has no runnable code yet — skip it, report as "not implemented" in the summary, never treat as a failure.
- All logs/artifacts go in `.dev/repon/` (gitignored) — one `<service>.log` per service.

## Decision Gates

| Argument | Action |
|---|---|
| `up` | Bring the stack up (Execution Steps → up) |
| `down` | Stop the stack (Execution Steps → down) |
| `reset` | down → clear caches → `supabase db reset` → up |
| anything else / empty | Print usage (`up`, `down`, `reset`) and stop |

## Execution Steps

Exact commands: `references/commands.md`.

**up**: 1) check Docker via `docker ps` (see Hard Rules). 2) `supabase start`. 3) if `services/core-api/.env` is missing, bootstrap it from `supabase status -o env` — verify actual output keys, don't assume names. 4) background `pnpm start:dev` in `services/core-api`, wait for its boot log line or `/api/docs` to return 200. 5) background both Expo web servers (usuario-mobile:8091, proveedor-mobile:8092), wait for "Waiting on http" then curl 200. 6) report a status table.

**down**: for each port (3000, 8091, 8092), find and kill the listening process (`lsof -ti:<port>`), then `supabase stop`. Re-check each port is free; report per-service result.

**reset**: run `down`. Clear `apps/usuario-mobile/.expo`, `apps/proveedor-mobile/.expo`, `services/core-api/dist`. Run `supabase db reset` (state the data-wipe warning first). Run `up`.

## Output Contract

End every invocation with a status table (service | port | URL | state). On `up`/`reset` success, list the exact URLs to open. On any partial failure, name which service failed and paste the last ~10 lines of `.dev/repon/<service>.log` — never a blanket "everything is running."

## References

- `references/commands.md` — exact shell commands, env-var bootstrap mapping, readiness-check patterns.
