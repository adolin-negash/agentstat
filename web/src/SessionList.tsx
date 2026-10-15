import { compact, date, sourceLabel, total } from "./format";
import { modelColors, type Theme } from "./modelColors";
import type { Dashboard, Options } from "./types";

export function SessionList({
  dashboard,
  theme,
  options,
  onSelect,
}: {
  dashboard: Dashboard;
  theme: Theme;
  options: Options;
  onSelect: (id: string) => void;
}) {
  const projectNames = new Map(
    options.projects.map((project) => [project.id, project.name]),
  );
  const sourceNames = new Map(
    options.sources.map((source) => [source.id, source.name]),
  );
  const { colors } = modelColors(dashboard, theme);
  return (
    <section id="sessions" class="sessions-panel">
      <div class="section-head">
        <div>
          <h2>Sessions</h2>
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
                {sourceLabel(sourceNames.get(session.sourceId))} <span>·</span>{" "}
                {projectNames.get(session.projectId) || "Unknown project"}{" "}
                <span>·</span> {date(session.created)}
              </div>
            </div>
            <div class="session-model">
              {(session.models.length ? session.models : [session.model])
                .slice(0, 2)
                .map((model, index) => (
                  <span key={`${model}-${index}`}>
                    {index > 0 && ", "}
                    <span style={{ color: colors[model] || colors.Unknown }}>
                      {model}
                    </span>
                  </span>
                ))}
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
