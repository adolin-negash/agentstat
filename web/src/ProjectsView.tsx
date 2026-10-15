import { useMemo, useState } from "preact/hooks";
import { date, num, sourceLabel, total } from "./format";
import { SessionList } from "./SessionList";
import { BackIcon } from "./BackIcon";
import type { Dashboard, Options } from "./types";
import type { Theme } from "./modelColors";

type SortKey =
  | "name"
  | "source"
  | "folder"
  | "created"
  | "sessions"
  | "recent"
  | "total"
  | "input"
  | "uncached"
  | "output";
const columns: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name" },
  { key: "source", label: "Source" },
  { key: "created", label: "Created" },
  { key: "sessions", label: "Sessions" },
  { key: "recent", label: "Recent session" },
  { key: "total", label: "Total tokens" },
  { key: "input", label: "Input tokens" },
  { key: "uncached", label: "Uncached input" },
  { key: "output", label: "Output tokens" },
  { key: "folder", label: "Folder" },
];

export function ProjectsView({
  dashboard,
  options,
  theme,
  selectedProject,
  onProject,
  onSession,
}: {
  dashboard: Dashboard;
  options: Options;
  theme: Theme;
  selectedProject: string;
  onProject: (id: string) => void;
  onSession: (id: string) => void;
}) {
  const [sort, setSort] = useState<{ key: SortKey; direction: 1 | -1 }>({
    key: "name",
    direction: 1,
  });
  const projects = useMemo(() => {
    const sessionsByProject = new Map<string, Dashboard["sessions"]>();
    for (const session of dashboard.sessions) {
      const sessions = sessionsByProject.get(session.projectId) || [];
      sessions.push(session);
      sessionsByProject.set(session.projectId, sessions);
    }
    return options.projects
      .filter((project) => sessionsByProject.has(project.id))
      .map((project) => {
        const sessions = sessionsByProject.get(project.id)!;
        const folders = [
          ...new Set(
            sessions
              .map(
                (session) =>
                  options.folders.find(
                    (folder) => folder.id === session.folderId,
                  )?.path,
              )
              .filter((path): path is string => Boolean(path)),
          ),
        ].sort();
        return {
          ...project,
          sessions,
          folders,
          folder: folders[0] || "—",
          source: [
            ...new Set(
              sessions.map((session) =>
                sourceLabel(
                  options.sources.find(
                    (source) => source.id === session.sourceId,
                  )?.name,
                ),
              ),
            ),
          ]
            .sort()
            .join(", "),
          created: sessions.reduce(
            (first, session) => Math.min(first, session.created),
            Infinity,
          ),
          recent: sessions.reduce(
            (latest, session) => Math.max(latest, session.created),
            -Infinity,
          ),
          total: sessions.reduce(
            (sum, session) => sum + total(session.tokens),
            0,
          ),
          input: sessions.reduce(
            (sum, session) =>
              sum +
              session.tokens.input +
              session.tokens.cacheRead +
              session.tokens.cacheWrite,
            0,
          ),
          uncached: sessions.reduce(
            (sum, session) => sum + session.tokens.input,
            0,
          ),
          output: sessions.reduce(
            (sum, session) => sum + session.tokens.output,
            0,
          ),
        };
      });
  }, [dashboard.sessions, options.folders, options.projects, options.sources]);
  const sortedProjects = useMemo(
    () =>
      [...projects].sort((a, b) => {
        const left = sort.key === "sessions" ? a.sessions.length : a[sort.key];
        const right = sort.key === "sessions" ? b.sessions.length : b[sort.key];
        const order =
          typeof left === "string" && typeof right === "string"
            ? left.localeCompare(right)
            : Number(left) - Number(right);
        return (
          order * sort.direction ||
          a.name.localeCompare(b.name) ||
          a.id.localeCompare(b.id)
        );
      }),
    [projects, sort],
  );

  const project = projects.find((item) => item.id === selectedProject);
  if (selectedProject && project) {
    const mean = (value: number) =>
      new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 1,
      }).format(value / project.sessions.length);
    const actions = project.sessions.reduce(
      (sum, session) => sum + session.actionCount,
      0,
    );
    const toolCalls = project.sessions.reduce(
      (sum, session) => sum + session.toolCalls,
      0,
    );
    return (
      <div class="project-detail">
        <button
          class="project-back"
          type="button"
          onClick={() => onProject("")}
          aria-label="Back to projects"
        >
          <BackIcon />
        </button>
        <h2 title={project.name}>{project.name}</h2>
        <div class="project-properties">
          <dl>
            <dt>Source</dt>
            <dd>{project.source}</dd>
            <dt>Created</dt>
            <dd>{date(project.created)}</dd>
            <dt>Last change</dt>
            <dd>{date(project.recent)}</dd>
            <dt>Folders</dt>
            <dd>{project.folders.length ? project.folders.join(", ") : "—"}</dd>
            <dt>Sessions</dt>
            <dd>{num(project.sessions.length)}</dd>
          </dl>
          <dl>
            <dt>Total tokens</dt>
            <dd>{num(project.total)}</dd>
            <dt>Input tokens</dt>
            <dd>{num(project.input)}</dd>
            <dt>Uncached input</dt>
            <dd>{num(project.uncached)}</dd>
            <dt>Output tokens</dt>
            <dd>{num(project.output)}</dd>
          </dl>
          <dl>
            <dt>Total actions</dt>
            <dd>{num(actions)}</dd>
            <dt>Mean tokens / session</dt>
            <dd>{mean(project.total)}</dd>
            <dt>Mean actions / session</dt>
            <dd>{mean(actions)}</dd>
            <dt>Mean tool calls / session</dt>
            <dd>{mean(toolCalls)}</dd>
          </dl>
        </div>
        <SessionList
          dashboard={{ ...dashboard, sessions: project.sessions }}
          theme={theme}
          options={options}
          onSelect={onSession}
        />
      </div>
    );
  }

  return (
    <section class="projects-panel">
      <div class="section-head">
        <h2>Projects</h2>
        <span class="count">{projects.length} results</span>
      </div>
      {projects.length ? (
        <div class="project-list">
          <div class="project-list-head">
            {columns.map(({ key, label }) => (
              <span
                key={key}
                role="columnheader"
                aria-sort={
                  sort.key === key
                    ? sort.direction === 1
                      ? "ascending"
                      : "descending"
                    : "none"
                }
              >
                <button
                  type="button"
                  onClick={() =>
                    setSort((current) => ({
                      key,
                      direction:
                        current.key === key && current.direction === 1 ? -1 : 1,
                    }))
                  }
                >
                  {label}{" "}
                  <span aria-hidden="true">
                    {sort.key === key ? (sort.direction === 1 ? "▲" : "▼") : ""}
                  </span>
                </button>
              </span>
            ))}
          </div>
          {sortedProjects.map((item) => (
            <button
              key={item.id}
              class="project-row"
              type="button"
              onClick={() => onProject(item.id)}
            >
              <strong title={item.name}>{item.name}</strong>
              <span title={item.source}>
                <small>Source</small>
                {item.source}
              </span>
              <span>
                <small>Created</small>
                {date(item.created)}
              </span>
              <span>
                <small>Sessions</small>
                {item.sessions.length}
              </span>
              <span>
                <small>Recent session</small>
                {date(item.recent)}
              </span>
              <span>
                <small>Total tokens</small>
                {num(item.total)}
              </span>
              <span>
                <small>Input tokens</small>
                {num(item.input)}
              </span>
              <span>
                <small>Uncached input</small>
                {num(item.uncached)}
              </span>
              <span>
                <small>Output tokens</small>
                {num(item.output)}
              </span>
              <span class="project-folder" title={item.folder}>
                <small>Folder</small>
                {item.folder}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div class="empty-list">
          No projects imported yet. Refresh data after configuring a source.
        </div>
      )}
    </section>
  );
}
