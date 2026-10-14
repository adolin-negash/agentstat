# Agent Stats: requirements and implementation plan

## Goal

Build a local, read-only web dashboard for OpenCode, Codex, GitHub Copilot IDEA, and Kilo Code history. Import source data into an app-owned SQLite database, then browse sessions, inspect ordered actions, and compare token use over time. The visual reference is [Agent Sessions](https://github.com/jazzyalex/agent-sessions/).

## Sources and assumptions

- OpenCode installations can contain legacy `session` / `message` / `part` tables and newer `session_v2` / `session_message` tables in `~/.local/share/opencode/opencode.db`. Older JSON storage is not supported.
- Codex sessions are JSONL rollout files under `~/.codex/sessions`. The importer reads session metadata, turn context, user and assistant messages, tool calls and results, reasoning summaries, and cumulative token events. It does not store system or developer messages or encrypted reasoning.
- GitHub Copilot IDEA agent sessions are JSONL event journals under `~/.copilot/session-state`, selected only when `workspace.yaml` records `client_name: copilot-intellij`. The importer reads prompts, replies, tools, permission requests, and recorded output tokens. These journals do not provide input, reasoning, or cache token counts; those categories remain zero rather than estimated. Older JetBrains Nitrite/Xodus chat stores and non-IDE Copilot sessions are outside this importer.
- Current Kilo Code CLI and IDE integrations store local sessions in `~/.local/share/kilo/kilo.db` by default. The importer reads its `session`, `message`, and `part` SQLite records, with per-model token usage from assistant messages. Legacy VS Code extension JSON task directories and cloud-only sessions are outside this importer.
- The app database stores each project once in `projects`, keyed by the stable source project ID. Models, folder paths, and source names also have their own tables. Sessions reference all four tables; model usage references the same model rows. The latest session update supplies the displayed project name. Existing app databases are converted once with a backup, while the running app only creates and reads the current schema.
- OpenCode, Codex, Copilot, and Kilo Code source files are read-only. Session IDs from Codex, Copilot, and Kilo Code are prefixed in the app database. Codex project identity uses its recorded working directory; Copilot uses its recorded Git root or working directory; Kilo Code uses its recorded project ID.
- Codex token events include cached input within input tokens and reasoning output within output tokens. The importer separates those categories and uses differences between cumulative events. Model attribution follows the latest turn context.
- Time filters use local browser time and an inclusive start / exclusive end range. Charts group by local calendar day.
- Model filtering is multi-select. A session can use multiple models; per-model token totals come from source usage records. Sessions with no model-level usage remain visible under `Unknown`.
- Import runs at startup and with Refresh. If one source is unavailable, the others are still imported and the issue appears in status. A headless `import` command can select source names and exits after reporting new-session counts and errors.
- The app binds to localhost by default. Imported transcripts may contain private data, so the app database is ignored by Git.

## Tasks

1. **Data model and importers**: maintain app SQLite tables for projects, models, folders, sources, sessions, actions, and model usage; read both OpenCode SQLite schemas, Codex JSONL, Copilot IDEA agent journals, and Kilo Code SQLite; upsert records without deleting valid history.
2. **Go API**: expose health/import status, filter options, filtered session list, one session's ordered action tree, and daily stats. Validate date, model, project, source, and session-name parameters.
3. **Preact UI**: build a responsive dashboard with date range, project, source, session-name, and multi-model filters; token bar chart; summary cards; session list; and expandable action tree.
4. **Verification**: use small fixture sources to test import and aggregation, run Go tests and frontend build, and check source handling without committing real transcripts.
5. **Documentation**: explain setup, source locations, import behavior, privacy, and limitations in README and AGENTS.md.

Follow-up work: add JSON-file source support for older OpenCode installations, incremental imports for very large histories, and per-message token reconciliation when OpenCode's session totals differ from message totals.

## Maintainability checks

- Keep startup, source imports, repository queries and migrations, service business rules, API handlers, and shared models in focused Go files under `backend/`. The repository owns app SQLite access and read-only OpenCode queries; the service owns import coordination, filtering, and dashboard aggregation. Keep the Go module at the repository root so `go test ./...` covers the backend.
- Run `make` to build the frontend, run Go formatting and vet, frontend ESLint, TypeScript and formatting checks, 75% minimum Go and frontend statement coverage gates, and Go tests before building the distributable executable. `make check` runs validation without the final binary build.
- GitHub Actions runs these checks on pull requests and pushes, saves Go and frontend coverage reports, builds the frontend once in the check job, and downloads that build in native CGO binary jobs for Windows, macOS, and Linux on amd64 and arm64 runners. A `v*` tag publishes all six archives only after checks and builds pass.

## Acceptance criteria

- Starting the server with an OpenCode SQLite source, Codex sessions directory, or Copilot IDEA agent journal directory creates a separate SQLite database and returns imported sessions.
- Copilot import includes only IDEA-owned journals, preserves their session IDs, YAML workspace names, and event order, attributes recorded output tokens to each message's model, and shows unavailable token categories as zero.
- Kilo Code import reads its SQLite database without writing to it, prefixes session, project, message, and part IDs to avoid collisions, preserves chronological actions, and attributes recorded assistant tokens by model.
- Every imported session references a project row. Project filters use its ID; the options response supplies the name used in session details, and a project rename follows the latest imported session update.
- Every imported session references model, folder, and source rows, and usage references model rows. Session API responses use project, folder, and source IDs; the options response exposes their original names and paths for display. Model names remain available in session and usage responses.
- All four sources can coexist; source, project, date, and model filters update cards, chart, and session list consistently.
- Session-name search matches titles case-insensitively and combines with other filters across cards, chart, and session list.
- The existing violet theme is the default; users can switch to a Claude Code inspired orange-and-black theme, and their choice persists across reloads.
- The project picker closes when clicking outside it or pressing Escape.
- Project, source, and model filters use multi-select pickers. A search field appears when an open picker has more than five choices; each picker closes on outside click or Escape.
- Date-time filters accept local times, display them as `yyyy-mm-dd HH:MM` in controls sized to their content, close on Escape, and can each be cleared with an X that leaves the value empty.
- UI timestamps use local time in `yyyy-mm-dd HH:MM` format.
- The chart shows a distinct color for each model; clicking a day or dragging across days sets the date-time range and filters cards and sessions.
- Clicking a model in the overview chart legend selects it in the model filter; clicking the selected model again clears that selection.
- The overview Clear button appears for a selected date range or model and clears both selections.
- The overview chart axis shows day numbers, grouped month labels, and grouped year labels on separate lines.
- Chart bars rescale with filtered token totals and keep small nonzero model segments and zero-token session days visible.
- Multiple selected models show combined usage without counting a token event twice.
- Overview and session details show cached input reads and writes separately from uncached input.
- The dashboard orders the overview chart, compact session summary, filters, and sessions list. Session details use a compact token summary without a cache duration note.
- The session detail summary is one selectable text box with three columns of label-value pairs; values align vertically within each column and remain readable on narrow screens.
- Selecting a session shows its actions in order, including tool input and result when saved, and a token breakdown.
- Session details summarize the source and start date, and long saved action text can be expanded and collapsed without losing content.
- OpenCode and Codex compaction events appear in the session action list at their recorded time, with saved OpenCode summaries and failure status when available.
- Session actions show explicit aborts and failures when a source records them, including token-limit failures for recorded length or context-limit errors. OpenCode agent switches appear at their recorded time. Context-window size alone does not imply a limit failure.
- Codex session actions show explicit elevated tool permission requests with their saved justification and recorded time. OpenCode project permission rules are not treated as session request events.
- Selecting a session opens a full-screen view with one details scrollbar and a compact, fixed caption showing its name, start date and time, and project.
- Session action details preserve and display the full saved text, including long messages and available reasoning summaries.
- Session action text, saved tool input, and saved tool results can each be copied in full from the session view, including while collapsed.
- An empty or unavailable source has an actionable UI state and does not crash the server.
- Running without a command keeps the startup import and web server. `import` runs without a server, reports the number of newly added sessions, and preserves imported sessions, actions, and usage records that later disappear from a source.
- A distribution build embeds the production UI in one Go executable. It serves the UI from any working directory without a separate frontend folder, and stores its default app database in the user's configuration directory. The headless `import` command remains available in the same executable.
- `agentstat -version` prints the executable's version without starting the server or opening a database. The web UI shows the same version from `/api/status`; local builds default to `dev`, and tagged release binaries use their tag.
- The maintainability checks pass, including 75% statement coverage floors for Go and frontend code.
- CI publishes coverage artifacts for both backend and frontend, then shares one frontend build with all six binary jobs. Tagged releases contain working binaries with the embedded UI for Windows, macOS, and Linux on amd64 and arm64. The Windows ARM64 build uses an installed ARM64 MinGW C compiler for CGO, checks its target, and runs the packaged binary's version and import smoke checks.
