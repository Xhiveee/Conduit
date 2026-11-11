# Conduit

Portable Windows SSH client with a built-in AI agent (Go + Wails v2 + vanilla TS + xterm.js).

## Build / verify

- Build exe: `./.tools/bin/wails.exe build -o Conduit.exe` → `build/bin/Conduit.exe`
- Dev mode: `./.tools/bin/wails.exe dev`
- NEVER use `wails build -clean` and never delete/clean `build/bin/data` — the user runs `build/bin/Conduit.exe` and their real hosts/settings/API key live in `build/bin/data/`.
- `wails dev`, e2e and any test runs MUST set `CONDUIT_DATA_DIR` to a dir inside `.clean/` so they never touch `build/bin/data` or repo data.
- Go: `go vet ./... && go test ./...`
- Frontend: `cd frontend && npm.cmd run build` (use `npm.cmd`, plain `npm` is broken in bash)
- E2E (docker sshd required): `go test -tags e2e ./...` with `CONDUIT_E2E_*` env vars — see `.devin/skills/conduit-dev/SKILL.md`

## Layout

Flat Go backend in repo root (`main.go`, `app.go`, `store.go`, `keys.go`, `sessions.go`, `terminal_text.go`, `agent.go`, `llm.go`, `sessions_e2e_test.go`). Frontend modules in `frontend/src/`. Wails CLI lives in `.tools/bin/` (not committed). Runtime data next to exe in `data/` (not committed); tests use `CONDUIT_DATA_DIR`.

## Conventions

No code comments except a one-line WHY for non-obvious hacks. No debug output. Vanilla TS, no framework. Icons via `lucide` `createElement`. Events Go→JS via `runtime.EventsEmit` (`session:*`, `agent:*`, `settings:changed`, `ui:focus`).
