import { render } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { SessionView } from "./SessionView";
import { Filters } from "./Filters";
import { Overview, SessionSummary } from "./Overview";
import { SessionList } from "./SessionList";
import { ProjectsView } from "./ProjectsView";
import { date, emptyDashboard } from "./format";
import type { Dashboard, Detail, Options, Status } from "./types";
import "./style.css";

type Theme = "default" | "claude";
type View = "sessions" | "projects" | "settings";

function ViewIcon({ view }: { view: View }) {
  if (view === "projects")
    return (
      <svg
        class="nav-icon"
        viewBox="0 0 14 14"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M7,1V5h4V1Zm3,3H8V2h2ZM7,7v4h4V7Zm3,3H8V8h2ZM1,1V5H5V1ZM4,4H2V2H4ZM1,7v4H5V7Zm3,3H2V8H4Z" />
      </svg>
    );
  if (view === "sessions")
    return (
      <svg
        class="nav-icon"
        viewBox="0 0 32 32"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <rect x="3" y="4" width="8" height="8" rx="2" />
        <rect x="21" y="20" width="8" height="8" rx="2" />
        <path d="M11 8h9a5 5 0 0 1 0 10h-8a5 5 0 0 0 0 10h3M25 18v2" />
      </svg>
    );
  return (
    <svg
      class="nav-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M8.9 4.52 9.75 2.26 14.25 2.26 15.1 4.52 17.3 3.52 20.48 6.7 19.48 8.9 21.74 9.75 21.74 14.25 19.48 15.1 20.48 17.3 17.3 20.48 15.1 19.48 14.25 21.74 9.75 21.74 8.9 19.48 6.7 20.48 3.52 17.3 4.52 15.1 2.26 14.25 2.26 9.75 4.52 8.9 3.52 6.7 6.7 3.52Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function savedTheme(): Theme {
  try {
    return localStorage.getItem("agentstat-theme") === "claude"
      ? "claude"
      : "default";
  } catch {
    return "default";
  }
}

const initialTheme = savedTheme();
document.documentElement.dataset.theme = initialTheme;

async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function App() {
  const [view, setView] = useState<View>("sessions");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [options, setOptions] = useState<Options>({
    projects: [],
    folders: [],
    models: [],
    sources: [],
  });
  const [status, setStatus] = useState<Status | null>(null);
  const [showVersion, setShowVersion] = useState(false);
  const versionButton = useRef<HTMLButtonElement>(null);
  const closeVersionButton = useRef<HTMLButtonElement>(null);
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [projectDashboard, setProjectDashboard] = useState<Dashboard | null>(
    null,
  );
  const [projectLoading, setProjectLoading] = useState(false);
  const [projectError, setProjectError] = useState("");
  const [selectedProject, setSelectedProject] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [importNotice, setImportNotice] = useState<{ message: string } | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!importNotice) return;
    const timer = window.setTimeout(() => setImportNotice(null), 10_000);
    return () => window.clearTimeout(timer);
  }, [importNotice]);

  useEffect(() => {
    if (!showVersion) return;
    closeVersionButton.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setShowVersion(false);
      if (event.key === "Tab") {
        event.preventDefault();
        closeVersionButton.current?.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      versionButton.current?.focus();
    };
  }, [showVersion]);

  function changeTheme(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("agentstat-theme", next);
    } catch {
      // The theme remains usable when browser storage is unavailable.
    }
  }

  function openView(next: View) {
    setSelected("");
    setSelectedProject("");
    setView(next);
  }

  const params = useMemo(() => {
    const query = new URLSearchParams();
    projects.forEach((project) => query.append("project", project));
    if (from) query.set("from", String(new Date(from).getTime()));
    if (to) query.set("to", String(new Date(to).getTime()));
    models.forEach((model) => query.append("model", model));
    sources.forEach((source) => query.append("source", source));
    if (name.trim()) query.set("name", name.trim());
    if (regex) query.set("regex", "1");
    if (caseSensitive) query.set("case_sensitive", "1");
    return query.toString();
  }, [projects, models, sources, from, to, name, regex, caseSensitive]);

  useEffect(() => {
    Promise.all([get<Options>("/api/options"), get<Status>("/api/status")])
      .then(([nextOptions, nextStatus]) => {
        setOptions(nextOptions);
        setStatus(nextStatus);
      })
      .catch((err) => setError(String(err)));
  }, []);

  useEffect(() => {
    let active = true;
    setLoading(true);
    get<Dashboard>("/api/dashboard" + (params ? "?" + params : ""))
      .then((data) => {
        if (active) {
          setDashboard(data);
          setError("");
        }
      })
      .catch((err) => {
        if (active) setError(String(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [params]);

  useEffect(() => {
    if (view !== "projects") return;
    let active = true;
    setProjectLoading(true);
    setProjectError("");
    get<Dashboard>("/api/dashboard")
      .then((data) => {
        if (active) setProjectDashboard(data);
      })
      .catch((err) => {
        if (active) setProjectError(String(err));
      })
      .finally(() => {
        if (active) setProjectLoading(false);
      });
    return () => {
      active = false;
    };
  }, [view]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      return;
    }
    let active = true;
    setDetail(null);
    setDetailError("");
    get<Detail>("/api/sessions/" + encodeURIComponent(selected))
      .then((data) => {
        if (active) setDetail(data);
      })
      .catch((err) => {
        if (active) setDetailError(String(err));
      });
    return () => {
      active = false;
    };
  }, [selected]);

  async function refresh() {
    setBusy(true);
    setError("");
    setImportNotice(null);
    try {
      const response = await fetch("/api/import", { method: "POST" });
      if (!response.ok) throw new Error((await response.json()).error);
      const nextStatus = (await response.json()) as Status;
      setStatus(nextStatus);
      setImportNotice({
        message:
          nextStatus.importedSessions > 0
            ? `${nextStatus.importedSessions} ${nextStatus.importedSessions === 1 ? "Session" : "Sessions"} imported`
            : "Nothing to import",
      });
      const [nextOptions, nextDashboard] = await Promise.all([
        get<Options>("/api/options"),
        get<Dashboard>("/api/dashboard" + (params ? "?" + params : "")),
      ]);
      setOptions(nextOptions);
      setDashboard(nextDashboard);
      setProjectDashboard(null);
      if (selected)
        setDetail(
          await get<Detail>("/api/sessions/" + encodeURIComponent(selected)),
        );
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class={`shell${view === "projects" && !selectedProject ? " projects-layout" : ""}`}
    >
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-icon">◈</span>
          <div>
            <b>Agent</b>
            <small>STATS</small>
          </div>
        </div>
        <nav aria-label="Main navigation">
          <button
            type="button"
            class={view === "sessions" ? "active" : ""}
            aria-current={view === "sessions" ? "page" : undefined}
            onClick={() => openView("sessions")}
          >
            <ViewIcon view="sessions" /> <span>Sessions</span>
          </button>
          <button
            type="button"
            class={view === "projects" ? "active" : ""}
            aria-current={view === "projects" ? "page" : undefined}
            onClick={() => openView("projects")}
          >
            <ViewIcon view="projects" /> <span>Projects</span>
          </button>
          <button
            type="button"
            class={view === "settings" ? "active" : ""}
            aria-current={view === "settings" ? "page" : undefined}
            onClick={() => openView("settings")}
          >
            <ViewIcon view="settings" />
            <span>Settings</span>
          </button>
        </nav>
        <div class="side-bottom">
          <span>{status?.sessions ?? "—"} sessions indexed</span>
          <button
            ref={versionButton}
            type="button"
            class="version-trigger"
            onClick={() => setShowVersion(true)}
          >
            Version {status?.version ?? "—"}
          </button>
        </div>
      </aside>
      {showVersion && (
        <div class="version-backdrop" onClick={() => setShowVersion(false)}>
          <section
            class="version-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="version-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              ref={closeVersionButton}
              type="button"
              class="version-close"
              aria-label="Close version details"
              onClick={() => setShowVersion(false)}
            >
              ×
            </button>
            <h2 id="version-dialog-title">App information</h2>
            <dl class="version-details">
              <div>
                <dt>App version</dt>
                <dd>{status?.version || "—"}</dd>
              </div>
              <div>
                <dt>Last successful import</dt>
                <dd>
                  {status?.lastImport &&
                  status.lastImport !== "0001-01-01T00:00:00Z"
                    ? date(status.lastImport)
                    : "Never"}
                </dd>
              </div>
              <div>
                <dt>Server host and port</dt>
                <dd>{status?.serverAddress || "—"}</dd>
              </div>
              <div>
                <dt>Local database path</dt>
                <dd>{status?.databasePath || "—"}</dd>
              </div>
              <div>
                <dt>OpenCode source</dt>
                <dd>{status?.source || "Not configured"}</dd>
              </div>
              <div>
                <dt>Codex source</dt>
                <dd>{status?.codexSource || "Not configured"}</dd>
              </div>
              <div>
                <dt>GitHub Copilot IDEA source</dt>
                <dd>{status?.copilotSource || "Not configured"}</dd>
              </div>
              <div>
                <dt>Kilo Code source</dt>
                <dd>{status?.kiloSource || "Not configured"}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}
      {importNotice && (
        <div class="import-notice" role="status">
          {importNotice.message}
        </div>
      )}
      <main>
        <header class="topbar">
          <div>
            <h1>
              <ViewIcon view={view} />
              {view === "sessions"
                ? "Sessions"
                : view === "projects"
                  ? "Projects"
                  : "Settings"}
            </h1>
          </div>
        </header>
        {view === "settings" && (
          <>
            {status?.importError && (
              <div class="notice">Import issue: {status.importError}</div>
            )}
            {error && <div class="notice">{error}</div>}
            <section class="settings-panel" aria-label="Settings controls">
              <label class="settings-row theme-picker">
                <span>Theme</span>
                <select
                  value={theme}
                  onChange={(event) =>
                    changeTheme(event.currentTarget.value as Theme)
                  }
                >
                  <option value="default">Default</option>
                  <option value="claude">Claude Code</option>
                </select>
              </label>
              <div class="settings-row">
                <span>Data reload</span>
                <button
                  type="button"
                  class="refresh settings-refresh"
                  onClick={refresh}
                  disabled={busy}
                >
                  {busy ? "Importing…" : "Refresh data"}
                </button>
              </div>
            </section>
          </>
        )}
        {view === "sessions" && (
          <>
            {status?.importError && (
              <div class="notice">Import issue: {status.importError}</div>
            )}
            {error && <div class="notice">{error}</div>}
            {loading ? (
              <div class="empty-chart">Loading sessions…</div>
            ) : (
              <>
                <Overview
                  dashboard={dashboard}
                  theme={theme}
                  from={from}
                  to={to}
                  selectedModels={models}
                  onModels={setModels}
                  onRange={(start, end) => {
                    setFrom(start);
                    setTo(end);
                  }}
                />
                <SessionSummary dashboard={dashboard} />
              </>
            )}
            <Filters
              options={options}
              projects={projects}
              models={models}
              sources={sources}
              name={name}
              regex={regex}
              caseSensitive={caseSensitive}
              from={from}
              to={to}
              onProjects={setProjects}
              onModels={setModels}
              onSources={setSources}
              onName={setName}
              onRegex={setRegex}
              onCaseSensitive={setCaseSensitive}
              onFrom={setFrom}
              onTo={setTo}
            />
            {!loading && (
              <SessionList
                dashboard={dashboard}
                theme={theme}
                options={options}
                onSelect={setSelected}
              />
            )}
          </>
        )}
        {view === "projects" && (
          <>
            {projectError && <div class="notice">{projectError}</div>}
            {projectLoading ? (
              <div class="empty-list">Loading projects…</div>
            ) : projectDashboard && !projectError ? (
              <ProjectsView
                dashboard={projectDashboard}
                options={options}
                theme={theme}
                selectedProject={selectedProject}
                onProject={setSelectedProject}
                onSession={setSelected}
              />
            ) : null}
          </>
        )}
      </main>
      {selected && (
        <SessionView
          key={selected}
          detail={detail}
          options={options}
          preview={(view === "projects"
            ? projectDashboard
            : dashboard
          )?.sessions.find((session) => session.id === selected)}
          error={detailError}
          onClose={() => setSelected("")}
        />
      )}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
