---
name: repon-logs
description: "Trigger: revisa los logs, algo se rompió, repon logs, check logs, error en core-api/usuario-mobile/proveedor-mobile. Analiza los logs del stack local de repon y propone fixes con archivo:línea."
license: Apache-2.0
metadata:
  author: "jpab"
  version: "1.0"
---

## Activation Contract

Load when the user asks to review/check logs for this repo (repon-monorepo), reports something broke in the local dev stack, or invokes `/repon-logs`.

## Hard Rules

- Logs only live at `.dev/repon/{core-api,usuario-mobile,proveedor-mobile}.log` — written by the `repon` skill's `up`/`reset` steps (see `.claude/skills/repon/SKILL.md`). A missing file means that service was never started via `/repon up` — say so, never invent content.
- Always tag each finding with its origin: `[core-api]` / `[usuario-mobile]` / `[proveedor-mobile]`.
- Never propose a fix without citing the exact file:line that produced it — grep the source for the stack trace, don't guess.
- Check log mtime before analyzing: a log from a stopped run is historical state, not live — say so explicitly.
- Never restart or kill a process — that's `/repon`'s job, not this skill's.

## Decision Gates

| Situation | Action |
|---|---|
| User pasted log text directly | Analyze that text, skip file reads |
| Log files exist, stack running (`lsof -ti:3000/8091/8092` hits) | Tail last ~200 lines fresh, analyze |
| Log files exist, stack stopped | Analyze last recorded output, flag as historical |
| Log file missing for a service | Report "never started via /repon up" for that service |
| No error patterns match | Report "sin errores detectados", suggest reproducing the scenario |

## Execution Steps

1. `lsof -ti:3000 -ti:8091 -ti:8092` to know which services are currently live.
2. Read each relevant `.dev/repon/<service>.log`, tail if large.
3. Grep with `-a` always — `core-api.log` carries Nest's ANSI color codes, and plain `grep` silently treats it as binary and reports zero matches (confirmed false negative in practice). Patterns: `\[Nest\].*ERROR`, `EADDRINUSE`, `TypeError`, `ReferenceError`, `Unhandled.*[Rr]ejection`, `ECONNREFUSED`, `ETIMEDOUT`, HTTP `4\d\d|5\d\d` on request lines, Metro/Expo `SyntaxError`/`Cannot use import statement`/bundling failures, Supabase connection errors.
4. For each hit, grep the actual source file the trace names to confirm the exact line before proposing a fix.
5. Group by service + error signature — never report line-by-line duplicates as separate findings.

## Output Contract

Return, in this order:
1. Summary table: `# | servicio | severidad | mensaje | ocurrencias`.
2. Per group: root cause, `archivo:línea`, proposed fix (diff-style if it's a code change).
3. Priority: CRÍTICO (unhandled exceptions, app won't boot) → ERROR (4xx/5xx, connection failures) → WARNING (deprecations, non-fatal).

## References

- `.claude/skills/repon/SKILL.md` — starts/stops the stack and owns the log file locations this skill reads.
