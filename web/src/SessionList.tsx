import { compact, date, total } from "./format";
import type { Dashboard, Options } from "./types";

export function SessionList({
  dashboard,
  options,
  onSelect,
}: {
  dashboard: Dashboard;
  options: Options;
  onSelect: (id: string) => void;
}) {
  const projectNames = new Map(
    options.projects.map((project) => [project.id, project.name]),
  );
  const sourceNames = new Map(
    options.sources.map((source) => [source.id, source.name]),
  );
  return (
    <section id="sessions" class="sessions-panel">
      <div class="section-head">
        <div>
          <h2>Sessions</h2>
          <p>Choose a session to inspect its activity</p>
        </div>
        <span class="count">{dashboard.sessions.length} results</span>
      </div>
      <div class="session-list">
        {dashboard.sessions.map((session) => (
          <button
            key={session.id}
            class="session-row"
            onClick={() => onSelect(session.id)}
          >
            <div class="session-symbol">⌘</div>
            <div class="session-main">
              <strong>{session.title || "Untitled session"}</strong>
              <div>
                {sourceNames.get(session.sourceId) === "codex"
                  ? "Codex"
                  : sourceNames.get(session.sourceId) === "copilot"
                    ? "GitHub Copilot"
                    : sourceNames.get(session.sourceId) === "opencode"
                      ? "OpenCode"
                      : sourceNames.get(session.sourceId) === "kilo"
                        ? "Kilo Code"
                        : "Unknown source"}{" "}
                <span>·</span>{" "}
                {projectNames.get(session.projectId) || "Unknown project"}{" "}
                <span>·</span> {date(session.created)}
              </div>
            </div>
            <div class="session-model">
              {session.models.slice(0, 2).join(", ") || session.model}
              {session.models.length > 2
                ? " +" + (session.models.length - 2)
                : ""}
            </div>
            <div class="session-tokens">
              {compact(total(session.tokens))}
              <small>tokens</small>
            </div>
            <span class="chevron">›</span>
          </button>
        ))}
        {!dashboard.sessions.length && (
          <div class="empty-list">No sessions match these filters.</div>
        )}
      </div>
    </section>
  );
}
