# Agent Stats

Agent Stats is a local dashboard for OpenCode, Codex, GitHub Copilot IDEA, and Kilo Code agent
history. A Go
server reads source histories and copies them into its own SQLite database. A Preact interface lets
you explore sessions, ordered actions, and token use. Source files are never changed.

## Main features

- **Four sources in one view:** import OpenCode and Kilo Code SQLite sessions, Codex JSONL rollouts,
  and GitHub
  Copilot IDEA agent journals. Import runs at startup, from **Refresh data**, or through a headless
  command.
- **Usage overview:** see session and token totals, uncached input, output, and cache reads and
  writes. A daily chart uses a distinct color for each model and includes session days with zero
  recorded tokens.
- **Combined filters:** narrow the chart, cards, and session list by source, project, model, session
  name, and start date/time. Source, project, and model pickers allow multiple selections. Click or
  drag across chart days to select a range; click a model in the legend to select it.
- **Session inspection:** open a session for its source, project, start time, token breakdown, model
  usage, and chronological actions. Expand and copy saved message text, tool input, and tool
  results. Messages, tools, reasoning summaries, compaction, permission requests, aborts, and errors
  appear when recorded by the source.
- **Local interface:** switch between the default violet and Claude Code inspired themes. The choice
  is saved in the browser. Empty histories and import issues are shown in the UI. The production UI
  is embedded in the executable.
- **Automated checks and releases:** GitHub Actions tests backend and frontend with coverage, builds
  binaries for Windows, macOS, and Linux on Intel/AMD 64-bit and ARM64, and publishes them for `v*`
  tags.
- **App version:** the web footer and `agentstat -version` show the same executable version.

## Requirements

- To build: Go 1.22.5 or later, a C compiler, Node.js 20 or later, and npm. The SQLite driver uses
  CGO, so build with CGO enabled on each target platform.
- To run a built executable: no Go or Node.js installation is needed. The target system still needs
  the platform's standard C runtime for the SQLite driver.
- At least one supported source history for a populated dashboard.

Run the build commands below from the repository root. The build embeds the frontend in the Go
executable; distribute only the resulting executable for the target OS and CPU architecture.

## Install and run

```sh
npm ci --prefix web
make
./dist/agentstat
```

### Docker

Build the image:

```sh
docker build -t agentstat .
```

The Docker build defaults to version `dev`. Pass a version when building a tagged image, for example
`docker build --build-arg VERSION=v1.0.0 -t agentstat:v1.0.0 .`.

Run the container, mounting your source directories and a data volume for the app database:

```sh
docker run -d \
  --name agentstat \
  -p 8080:8080 \
  -v ~/.local/share/opencode:/sources/opencode:ro \
  -v ~/.codex/sessions:/sources/codex:ro \
  -v ~/.copilot/session-state:/sources/copilot:ro \
  -v ~/.local/share/kilo:/sources/kilo:ro \
  -v agentstat-data:/data \
  agentstat
```

Open <http://127.0.0.1:8080>. The container uses these defaults (override with `-e`):

| Environment variable | Default                         | Purpose                              |
|----------------------|---------------------------------|--------------------------------------|
| `OPENCODE_DB`        | `/sources/opencode/opencode.db` | OpenCode SQLite database             |
| `CODEX_SESSIONS`     | `/sources/codex`                | Codex sessions directory             |
| `COPILOT_SESSIONS`   | `/sources/copilot`              | Copilot IDEA session-state directory |
| `KILO_DB`            | `/sources/kilo/kilo.db`         | Kilo Code SQLite database            |
| `AGENTSTAT_DB`       | `/data/agentstat.db`            | App SQLite database                  |
| `AGENTSTAT_ADDR`     | `0.0.0.0:8080`                  | HTTP listen address                  |

Example with custom paths:

```sh
docker run -d \
  -p 8080:8080 \
  -e OPENCODE_DB=/sources/opencode/opencode.db \
  -e CODEX_SESSIONS=/sources/codex \
  -e COPILOT_SESSIONS=/sources/copilot \
  -e KILO_DB=/sources/kilo/kilo.db \
  -e AGENTSTAT_DB=/data/agentstat.db \
  -v /path/to/opencode:/sources/opencode:ro \
  -v /path/to/codex/sessions:/sources/codex:ro \
  -v /path/to/copilot/session-state:/sources/copilot:ro \
  -v /path/to/kilo:/sources/kilo:ro \
  -v agentstat-data:/data \
  agentstat
```

Run the headless import command inside the container:

```sh
docker run --rm \
  -v ~/.local/share/opencode:/sources/opencode:ro \
  -v ~/.codex/sessions:/sources/codex:ro \
  -v ~/.copilot/session-state:/sources/copilot:ro \
  -v ~/.local/share/kilo:/sources/kilo:ro \
  -v agentstat-data:/data \
  agentstat import --source opencode,codex,copilot,kilo
```

Open <http://127.0.0.1:8080>. The server imports configured sources at startup. Press **Refresh data
** to scan them again. If one source is unavailable, the others can still import; the issue appears
in the UI. Copy `dist/agentstat` to another folder or machine with the same OS and CPU architecture;
it serves the interface without `web-dist/` or the repository. The `import` command is in the same
executable, for example `./dist/agentstat import --source codex`.

For frontend development, leave the Go server running and start Vite in another terminal:

```sh
npm run dev --prefix web
```

Open <http://127.0.0.1:5173>. Vite forwards `/api` to the Go server at `127.0.0.1:8080`. Run
`make` and restart the Go server to see frontend changes in the embedded interface.

### Server arguments

Start with `./dist/agentstat [flags]` (or `go run ./backend [flags]` after building the frontend).
Flags override environment variables. If neither is set, the default applies.

| Flag              | Environment variable | Default                                        | Purpose                                                                 |
|-------------------|----------------------|------------------------------------------------|-------------------------------------------------------------------------|
| `-source`         | `OPENCODE_DB`        | `~/.local/share/opencode/opencode.db`          | OpenCode SQLite database path. In server mode, this is a **file path**. |
| `-codex-source`   | `CODEX_SESSIONS`     | `~/.codex/sessions`                            | Codex rollout directory; JSONL files are found recursively.             |
| `-copilot-source` | `COPILOT_SESSIONS`   | `~/.copilot/session-state`                     | GitHub Copilot IDEA session-state directory.                            |
| `-kilo-source`    | `KILO_DB`            | `~/.local/share/kilo/kilo.db`                  | Kilo Code SQLite database path.                                         |
| `-db`             | `AGENTSTAT_DB`       | User config directory/`agentstat/agentstat.db` | App-owned SQLite database. Its parent directory is created if needed.   |
| `-addr`           | `AGENTSTAT_ADDR`     | `127.0.0.1:8080`                               | HTTP listen address. The default accepts local connections only.        |
| `-version`        | None                 | `dev` for local builds                         | Print the embedded app version and exit without starting the server.    |

```sh
./dist/agentstat -source /path/to/opencode.db -codex-source /path/to/codex/sessions -copilot-source /path/to/session-state -kilo-source /path/to/kilo.db -db /path/to/agentstat.db -addr 127.0.0.1:8080
./dist/agentstat -version
```

Pass an empty source path to skip that source in server mode, for example `-copilot-source ''`. A
missing path is different: the server attempts the import and reports an issue. An environment
variable set to an empty value falls back to its default, so use a flag to skip a source. Keep at
least one source configured if you want startup import or **Refresh data** to succeed.

### Headless import arguments

Use `./dist/agentstat import [flags]` to import and exit without starting the server. This command
has its own flags: **`--source` selects source names here**, while `-source` in server mode is the
OpenCode database path.

| Flag                | Environment variable | Default                                        | Purpose                                                                                                                                         |
|---------------------|----------------------|------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------|
| `--source`          | None                 | All four sources                               | Select `opencode`, `codex`, `copilot`, `kilo`, or a comma-separated combination. Spaces around names are ignored; duplicates are imported once. |
| `--opencode-source` | `OPENCODE_DB`        | `~/.local/share/opencode/opencode.db`          | OpenCode SQLite database path.                                                                                                                  |
| `--codex-source`    | `CODEX_SESSIONS`     | `~/.codex/sessions`                            | Codex sessions directory.                                                                                                                       |
| `--copilot-source`  | `COPILOT_SESSIONS`   | `~/.copilot/session-state`                     | GitHub Copilot IDEA session-state directory.                                                                                                    |
| `--kilo-source`     | `KILO_DB`            | `~/.local/share/kilo/kilo.db`                  | Kilo Code SQLite database path.                                                                                                                 |
| `--db`              | `AGENTSTAT_DB`       | User config directory/`agentstat/agentstat.db` | App-owned SQLite database path.                                                                                                                 |

```sh
./dist/agentstat import --source codex --codex-source /path/to/codex/sessions
./dist/agentstat import --source opencode,copilot --opencode-source /path/to/opencode.db --copilot-source /path/to/session-state
./dist/agentstat import --source kilo --kilo-source /path/to/kilo.db
```

With no `--source`, the command attempts all four, including unavailable sources. It prints the
number of **new** sessions for each selected source and in total, reports source errors, and exits
with an error if any selected source fails. Repeated imports update records still present in a
source and retain imported sessions, actions, and model usage that later disappear from it. An empty
path for a selected source is an error; omit it from `--source` instead.

## Dashboard filters

All filters combine. Within a multi-select picker, several choices include sessions matching **any**
selected value. Model filtering counts only the selected models' tokens in the cards and chart.

| Filter           | Behavior                                                                                                                                                                                                                       |
|------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Session name** | Case-insensitive substring search of the title; at most 200 characters.                                                                                                                                                        |
| **Sources**      | Include sessions from any selected source.                                                                                                                                                                                     |
| **From / To**    | Filter on when a session **started**. Enter local `yyyy-mm-dd HH:MM` or use the date picker. From is inclusive; To is exclusive. Either end can be cleared.                                                                    |
| **Projects**     | Include sessions from any selected project.                                                                                                                                                                                    |
| **Models**       | Include sessions with recorded usage for any selected model. Multiple models' usage is summed without counting a token event twice. With no model selected, usage lacking model attribution appears as `Unknown` in the chart. |

**Clear all** resets every filter. The chart's **Clear** button resets date and model selections
while leaving source, project, and name selections in place. Chart days use the server's local
timezone; the browser converts date inputs in its local timezone. Use matching timezones if day
boundaries matter.

## HTTP API and filter parameters

The UI uses these endpoints on the address set by `-addr`.

| Endpoint                 | Description                                                                                                                                       |
|--------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------|
| `GET /api/status`        | App version, configured source paths, last successful import time, latest import issue, and total indexed sessions.                               |
| `POST /api/import`       | Scan configured sources again, then return status. Returns an error if no source imports successfully.                                            |
| `GET /api/options`       | Available projects (`id`, `name`), model names, folders (`id`, `path`), and sources (`id`, `name`). Use these IDs for filters and session labels. |
| `GET /api/dashboard`     | Filtered sessions, summary totals, and daily chart bars.                                                                                          |
| `GET /api/sessions/{id}` | One session, its ordered actions, and model usage. A missing ID returns 404.                                                                      |

`/api/dashboard` accepts these query parameters. Omitted parameters do not restrict results.

| Parameter | Format and effect                                                                                                                                         |
|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|
| `from`    | Unix timestamp in **milliseconds**, inclusive. Filters session start time.                                                                                |
| `to`      | Unix timestamp in **milliseconds**, exclusive. Filters session start time. `from` greater than `to` returns HTTP 400.                                     |
| `project` | Project **ID** from `/api/options`, not its display name. Repeat for multiple projects.                                                                   |
| `source`  | Positive numeric source **ID** from `/api/options`, not `opencode`/`codex`/`copilot`/`kilo`. Repeat for multiple sources. Invalid values return HTTP 400. |
| `model`   | Exact model name from `/api/options`. Repeat for multiple models.                                                                                         |
| `name`    | Case-insensitive title substring, trimmed at both ends; at most 200 Unicode characters. An invalid value returns HTTP 400.                                |

Example (replace the IDs and timestamps with values from your data):

```text
/api/dashboard?source=1&source=2&project=my-project-id&model=gpt-5&from=1760000000000&to=1760086400000&name=refactor
```

API timestamps are Unix milliseconds. Dashboard bars use `YYYY-MM-DD` dates. URL-encode a session ID
when requesting `/api/sessions/{id}`. Invalid `from`, `to`, or `source` values return HTTP 400.

## Source data and token accounting

| Source              | Imported data                                                                                                                                                                                                                                                                                                        | Limits                                                                                                                                                                                        |
|---------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| OpenCode            | SQLite `session` / `message` / `part` and `session_v2` / `session_message` schemas; messages, tools, available compaction summaries, failures, aborts, and agent switches.                                                                                                                                           | Older JSON-file storage is unsupported. Its permission table records project rules, so it cannot reliably reconstruct session permission requests.                                            |
| Codex               | JSONL rollout metadata, user and assistant messages, tools and results, available reasoning summaries, compaction, explicit permission requests, aborts, errors, and cumulative token events.                                                                                                                        | System and developer messages and encrypted reasoning are skipped. Context-window size alone is not treated as a token-limit failure.                                                         |
| GitHub Copilot IDEA | Journals under `session-state` whose `workspace.yaml` has `client_name: copilot-intellij`; workspace session names (including multiline YAML names), prompts, replies, saved reasoning, tools, permission requests, aborts, and recorded output tokens. When the name is empty, the first prompt supplies the title. | The journals do not provide input, reasoning, or cache token counts, so those categories show zero. Older JetBrains Nitrite/Xodus stores and Copilot CLI or VS Code sessions are unsupported. |
| Kilo Code           | Local SQLite `session` / `message` / `part` records from current Kilo CLI and IDE integrations; message text, tool calls and results, and assistant token counts by model.                                                                                                                                           | Legacy Kilo VS Code extension JSON task directories and cloud-only sessions are unsupported. Session totals sum recorded assistant usage; missing token categories remain zero.               |

OpenCode session totals come from session records. Model filtering uses assistant-message usage and
attributes session totals to the session model when message-level usage is absent. Codex cumulative
events are converted to differences, separating cached input from input and reasoning from output.
Model attribution follows the latest turn context. Copilot IDEA uses each reply's recorded model and
output tokens. Kilo Code sums each assistant message's recorded usage by model. `Unknown` represents
usage without a known model. Token categories reflect source
records; the app does not track prices, provider quotas, or live activity.

For Kilo Code, `kilo db path` prints the database selected by its current environment. Set
`-kilo-source` or `KILO_DB` when that path differs from the default. The importer opens the file
read-only and copies its records into the app database.

## Data, privacy, and existing databases

The app reads source files without modifying them. Its database defaults to
`agentstat/agentstat.db` inside the user's configuration directory (on macOS,
`~/Library/Application Support`; on Linux, `$XDG_CONFIG_HOME` or `~/.config`). It holds copied
titles, metadata, token counts, messages, available reasoning summaries, and tool input and output.
If you used an older checkout with `data/agentstat.db`, pass
`-db /absolute/path/to/data/agentstat.db`
or set `AGENTSTAT_DB` to keep using it. `data/`, database files, transcripts, generated
`backend/web-dist/` output, and `dist/` executables are ignored by Git. Keep the server bound to
localhost unless you intentionally want to expose this data to other machines.

Projects, models, folders, and sources have separate lookup tables. Sessions reference those rows,
and model usage references model rows. Project display names follow the latest imported session
update. An old app database using a previous schema must be backed up and converted before this
version starts; the server reports a legacy-schema error and does not modify it. If all source
records still exist, you can instead point `-db` at a fresh app database and import again. Source
files themselves need no migration.

The app cannot identify individual prompt-cache entries or their expiry from imported histories.
Cache reads and writes show recorded token quantities only.

## Checks and documentation upkeep

```sh
make
```

The default Make target builds the frontend, runs Go formatting and vet, frontend ESLint, TypeScript
and Prettier checks, 75% Go and frontend statement coverage gates and Go tests, then builds
`dist/agentstat`. The binary
is built only after the checks pass. Use `make check` to run the checks without building the binary,
or `make build` to build it without running the checks. Build the frontend before running Go
commands
directly in a fresh checkout because the Go package embeds it.

GitHub Actions runs the same checks for pull requests and pushes to `main`, and stores a Go coverage
profile/HTML report and frontend LCOV/JSON summary as a workflow artifact. It builds native binaries
with CGO enabled on six runners; each workflow run keeps the archives as artifacts. Push a version
tag
such as `v1.0.0` to create a GitHub Release with `agentstat-{linux,darwin}-{amd64,arm64}.tar.gz`
and `agentstat-windows-{amd64,arm64}.zip`. Release archives contain the executable with the UI
embedded
and report their tag through `-version` and the web footer. Local `make` builds report `dev` by
default;
use `make VERSION=v1.0.0` to set another version.
Windows ARM64 needs an ARM64 Windows system; macOS and Linux archives are likewise architecture
specific.

When changing or adding a feature, update this README's relevant feature, setup, CLI, API, filter,
or limitation sections and keep [PLAN.md](PLAN.md) acceptance criteria current. Contributor guidance
is in [AGENTS.md](AGENTS.md).
