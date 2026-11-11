---
name: conduit-dev
description: Build, test, and verify the Conduit Wails SSH client in this repo. Use when changing Go backend, frontend, or running e2e checks.
---

# Conduit dev

Portable Windows SSH client (Termius-like) with a built-in AI agent. Go 1.27 + Wails v2.17.1 + vanilla TS/Vite + xterm.js.

## Tools (all local, nothing global)

- Wails CLI: `.tools/bin/wails.exe` (installed via `GOBIN=.tools/bin go install github.com/wailsapp/wails/v2/cmd/wails@v2.17.1`)
- In bash `npm` is broken: always use `npm.cmd` / `npx.cmd`.
- Go module path: `conduit`. Frontend dir: `frontend/`.

## Commands

- Dev: `CONDUIT_DATA_DIR="$(pwd -W)/.clean/devdata" ./.tools/bin/wails.exe dev` (always set `CONDUIT_DATA_DIR` inside `.clean/` for dev/e2e so real data in `build/bin/data` is never touched)
- Build: `./.tools/bin/wails.exe build -o Conduit.exe` → `build/bin/Conduit.exe` (NEVER `-clean`: it wipes `build/bin/` including `data/` where the user's real hosts/settings/API key live — never delete or clean `build/bin/data`)
- Go checks: `go vet ./...`, `go test ./...`
- Frontend typecheck+build: `cd frontend && npm.cmd run build`
- E2E (needs docker sshd, see below): `CONDUIT_E2E_HOST=127.0.0.1 CONDUIT_E2E_PORT=2222 CONDUIT_E2E_USER=test CONDUIT_E2E_PASSWORD=test go test -tags e2e ./...`

## Layout

- `main.go` — wails options (frameless, 1360x860, min 960x600, data dir = exe dir + `/data`, webview profile `data/webview`)
- `app.go` — bound methods, startup wiring
- `store.go` — Host/Settings/Theme types, `data/conduit.json` atomic persistence, ssh config import
- `keys.go` — `~/.ssh` key scan + Windows ssh-agent via `\\.\pipe\openssh-ssh-agent`
- `sessions.go` — SSH sessions (TOFU known_hosts, PTY, 512KB ring buffer, subscribers), `runInSession` agent command runner
- `terminal_text.go` — pure ANSI/prompt/key-parsing helpers (unit tested)
- `agent.go` — agent loop, 16 tools, command approval flow
- `llm.go` — OpenAI-compatible chat completions client
- `sessions_e2e_test.go` — docker sshd integration test behind `//go:build e2e`
- `frontend/src/` — `state.ts` (state+events), `themes.ts` (builtin themes), `terminal.ts` (xterm), `tabs.ts`, `sidebar.ts`, `agent-panel.ts`, `settings.ts`, `host-editor.ts`, `icons.ts`, `main.ts`, `style.css`
- `frontend/wailsjs/` — generated bindings, committed (needed for tsc)

## Data

Runtime data lives next to the exe: `data/conduit.json` (hosts+settings), `data/known_hosts`, `data/webview/` (WebView2 profile). Override with `CONDUIT_DATA_DIR` env (used by tests/e2e; point it into `.clean/`).

## Docker sshd e2e recipe

```
ssh-keygen -t ed25519 -f .clean/e2e_key -N ""
docker run -d --name conduit-sshd -p 2222:2222 \
  -e PASSWORD_ACCESS=true -e USER_PASSWORD=test -e USER_NAME=test \
  -v .clean/e2e_key.pub:/home/test/.ssh/authorized_keys:ro \
  -v .clean/e2e_key:/run/secrets/key:ro \
  lscr.io/linuxserver/openssh-server:latest
```

For key auth the linuxserver image reads `PUBLIC_KEY` env or `~/.ssh/authorized_keys`; password auth via `PASSWORD_ACCESS=true`+`USER_PASSWORD`. Then run the e2e go test with env vars above. Remove container+image when done (`docker rm -f conduit-sshd`, `docker rmi`).

## Rules

No code comments (one-line WHY only for non-obvious hacks). No console.log/print leftovers. Commit per logical piece with `git -c user.name="Devin" -c user.email="158243242+devin-ai-integration[bot]@users.noreply.github.com" commit` if git identity is unset. Scratch only in `.clean/` (git-ignored via `.git/info/exclude` and `.gitignore`).
