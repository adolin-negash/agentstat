# Contributor guidance

This repository is a local analytics app for OpenCode, Codex, and GitHub Copilot IDEA. Keep the Go API and Preact UI small and avoid adding other agent data sources.

- Read [PLAN.md](PLAN.md) before changing scope. Maintain its acceptance criteria as features change.
- Apply source-related features and fixes to all supported sources by default. Limit a change to one source only when the user explicitly specifies that source.
- Treat OpenCode, Codex, and GitHub Copilot IDEA source files as read-only. Never write to or migrate a user's source files.
- Import into the app-owned SQLite database. Preserve stable source IDs, chronological action order, project identity, model-level token accounting, and explicit handling for both supported OpenCode SQLite schemas, Codex JSONL rollouts, and Copilot IDEA journals.
- Do not commit `data/`, source database files, transcripts, or generated frontend output.
- Validate API filters and use parameterized SQL. Keep the server bound to localhost by default because copied transcripts can be sensitive.
- For UI changes, check empty, loading, error, narrow-screen, and long-title states. Keep filters, cards, chart, and session list consistent.
- When changing or adding a feature, update README.md so its features, installation, command arguments, API and filter parameters, source behavior, and limitations remain accurate. Update PLAN.md acceptance criteria when behavior changes.
- Run `go test ./...` and `npm run build --prefix web` before finishing implementation changes.
- **Docker**: The `Dockerfile` uses a multi-stage build. The builder stage compiles the frontend with Node.js and builds the Go binary with CGO enabled. The runtime stage uses `debian:bookworm-slim` with `libsqlite3-0`. When updating dependencies or build steps, keep the Dockerfile in sync with the Makefile and `go.mod`. Test locally with `docker build -t agentstat . && docker run --rm -p 8080:8080 -v agentstat-data:/data agentstat`.
