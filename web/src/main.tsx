import { render } from "preact";
import { useEffect, useMemo, useState } from "preact/hooks";
import { SessionView } from "./SessionView";
import { Filters } from "./Filters";
import { Overview, SessionSummary } from "./Overview";
import { SessionList } from "./SessionList";
import { date, emptyDashboard } from "./format";
import type { Dashboard, Detail, Options, Status } from "./types";
import "./style.css";

type Theme = "default" | "claude";

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
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [options, setOptions] = useState<Options>({
    projects: [],
    folders: [],
    models: [],
    sources: [],
  });
  const [status, setStatus] = useState<Status | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard>(emptyDashboard);
  const [projects, setProjects] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [sources, setSources] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [detailError, setDetailError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  function changeTheme(next: Theme) {
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("agentstat-theme", next);
    } catch {
      // The theme remains usable when browser storage is unavailable.
    }
  }

  const params = useMemo(() => {
    const query = new URLSearchParams();
    projects.forEach((project) => query.append("project", project));
    if (from) query.set("from", String(new Date(from).getTime()));
    if (to) query.set("to", String(new Date(to).getTime()));
    models.forEach((model) => query.append("model", model));
    sources.forEach((source) => query.append("source", source));
    if (name.trim()) query.set("name", name.trim());
    return query.toString();
  }, [projects, models, sources, from, to, name]);

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
    try {
      const response = await fetch("/api/import", { method: "POST" });
      if (!response.ok) throw new Error((await response.json()).error);
      const [nextOptions, nextStatus, nextDashboard] = await Promise.all([
        get<Options>("/api/options"),
        get<Status>("/api/status"),
        get<Dashboard>("/api/dashboard" + (params ? "?" + params : "")),
      ]);
      setOptions(nextOptions);
      setStatus(nextStatus);
      setDashboard(nextDashboard);
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
    <div class="shell">
      <aside class="sidebar">
        <div class="brand">
          <span class="brand-icon">◈</span>
          <div>
            <b>Agent</b>
            <small>STATS</small>
          </div>
        </div>
        <nav>
          <a class="active" href="#overview">
            ▥ <span>Overview</span>
          </a>
          <a href="#sessions">
            ▤ <span>Sessions</span>
          </a>
        </nav>
        <div class="side-bottom">
          <span class="pulse" /> Local data{" "}
          <small>{status?.sessions || 0} sessions indexed</small>
        </div>
      </aside>
      <main>
        <header class="topbar">
          <div>
            <span class="eyebrow">ANALYTICS / OVERVIEW</span>
            <h1>Workspace activity</h1>
            <p>
              Explore your OpenCode, Codex, GitHub Copilot, and Kilo Code
              sessions and token usage.
            </p>
          </div>
          <div class="topbar-actions">
            <label class="theme-picker">
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
            <button class="refresh" onClick={refresh} disabled={busy}>
              {busy ? "Importing…" : "↻  Refresh data"}
            </button>
          </div>
        </header>
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
          from={from}
          to={to}
          onProjects={setProjects}
          onModels={setModels}
          onSources={setSources}
          onName={setName}
          onFrom={setFrom}
          onTo={setTo}
        />
        {!loading && (
          <SessionList
            dashboard={dashboard}
            options={options}
            onSelect={setSelected}
          />
        )}
        <footer>
          Agent Stats · Local SQLite copy{" "}
          {status?.lastImport && status.lastImport !== "0001-01-01T00:00:00Z"
            ? `· Imported ${date(status.lastImport)}`
            : ""}
        </footer>
      </main>
      {selected && (
        <SessionView
          key={selected}
          detail={detail}
          options={options}
          preview={dashboard.sessions.find(
            (session) => session.id === selected,
          )}
          error={detailError}
          onClose={() => setSelected("")}
        />
      )}
    </div>
  );
}

render(<App />, document.getElementById("app")!);
