// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Filters } from "./Filters";
import { Overview, SessionSummary } from "./Overview";
import { SessionList } from "./SessionList";
import { SessionView } from "./SessionView";
import { emptyDashboard } from "./format";
import type { Dashboard, Options } from "./types";

const options: Options = {
  projects: [{ id: "project", name: "A very long project title" }],
  folders: [],
  models: ["model-a", "model-b"],
  sources: [{ id: 1, name: "codex" }],
};
const tokens = {
  input: 3,
  output: 4,
  reasoning: 1,
  cacheRead: 2,
  cacheWrite: 0,
};
const dashboard: Dashboard = {
  sessions: [
    {
      id: "session",
      sourceId: 1,
      projectId: "project",
      folderId: 1,
      title: "A very long session title that must remain readable",
      model: "model-a",
      models: ["model-a"],
      created: new Date(2026, 0, 2, 3, 4).getTime(),
      updated: new Date(2026, 0, 2, 3, 4).getTime(),
      tokens,
    },
  ],
  summary: { sessions: 1, tokens },
  bars: [
    { date: "2026-01-02", sessions: 1, tokens: 10, models: { "model-a": 10 } },
    { date: "2026-01-03", sessions: 1, tokens: 0, models: {} },
  ],
};

const host = document.createElement("div");
document.body.append(host);
afterEach(() => {
  act(() => render(null, host));
  host.replaceChildren();
});

describe("dashboard states", () => {
  it("shows useful empty states", () => {
    act(() => {
      render(
        <>
          <Overview
            dashboard={emptyDashboard}
            theme="default"
            from=""
            to=""
            selectedModels={[]}
            onRange={vi.fn()}
            onModels={vi.fn()}
          />
          <SessionList
            dashboard={emptyDashboard}
            options={options}
            onSelect={vi.fn()}
          />
        </>,
        host,
      );
    });
    expect(host.textContent).toContain("No usage in this range");
    expect(host.textContent).toContain("No sessions match these filters");
  });

  it("keeps titles and source labels and opens the selected session", () => {
    const onSelect = vi.fn();
    act(() =>
      render(
        <SessionList
          dashboard={dashboard}
          options={options}
          onSelect={onSelect}
        />,
        host,
      ),
    );
    expect(host.textContent).toContain(dashboard.sessions[0].title);
    expect(host.textContent).toContain("Codex");
    expect(host.textContent).toContain(options.projects[0].name);
    act(() => host.querySelector<HTMLButtonElement>(".session-row")?.click());
    expect(onSelect).toHaveBeenCalledWith("session");
  });

  it("filters the chart by day and model, then clears both selections", () => {
    const onRange = vi.fn();
    const onModels = vi.fn();
    act(() =>
      render(
        <Overview
          dashboard={dashboard}
          theme="default"
          from=""
          to=""
          selectedModels={[]}
          onRange={onRange}
          onModels={onModels}
        />,
        host,
      ),
    );
    expect(host.querySelectorAll(".bar-slot")).toHaveLength(2);
    expect(host.querySelector(".zero-usage")).not.toBeNull();
    act(() =>
      host.querySelector<HTMLButtonElement>(".chart-legend button")?.click(),
    );
    expect(onModels).toHaveBeenCalledWith(["model-a"]);
    act(() => {
      host
        .querySelector<HTMLButtonElement>(".bar-slot")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
    });
    expect(onRange).toHaveBeenCalledWith(
      "2026-01-02T00:00",
      "2026-01-03T00:00",
    );
    act(() =>
      render(
        <Overview
          dashboard={dashboard}
          theme="default"
          from="2026-01-02T00:00"
          to="2026-01-03T00:00"
          selectedModels={["model-a"]}
          onRange={onRange}
          onModels={onModels}
        />,
        host,
      ),
    );
    act(() => host.querySelector<HTMLButtonElement>(".chart-clear")?.click());
    expect(onRange).toHaveBeenLastCalledWith("", "");
    expect(onModels).toHaveBeenLastCalledWith([]);
  });

  it("shows the same token total in the session summary", () => {
    act(() => render(<SessionSummary dashboard={dashboard} />, host));
    expect(host.querySelector(".metrics")?.textContent).toContain(
      "10 incl. cached",
    );
  });
});

describe("filters", () => {
  const handlers = () => ({
    onProjects: vi.fn(),
    onModels: vi.fn(),
    onSources: vi.fn(),
    onName: vi.fn(),
    onFrom: vi.fn(),
    onTo: vi.fn(),
  });

  it("accepts valid local dates, rejects invalid dates, and clears filters", () => {
    const on = handlers();
    act(() =>
      render(
        <Filters
          options={options}
          projects={["project"]}
          models={[]}
          sources={[]}
          name="old"
          from=""
          to=""
          {...on}
        />,
        host,
      ),
    );
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="From date and time"]',
    )!;
    act(() => {
      input.value = "2026-02-30 12:00";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(on.onFrom).not.toHaveBeenCalled();
    act(() => {
      input.value = "2026-02-28 12:00";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(on.onFrom).toHaveBeenCalledWith("2026-02-28T12:00");
    act(() =>
      host.querySelector<HTMLButtonElement>(".filter-title button")?.click(),
    );
    expect(on.onProjects).toHaveBeenCalledWith([]);
    expect(on.onName).toHaveBeenCalledWith("");
    expect(on.onFrom).toHaveBeenLastCalledWith("");
  });
});

describe("session details", () => {
  it("shows loading and error states and allows closing", () => {
    const onClose = vi.fn();
    act(() =>
      render(
        <SessionView
          detail={null}
          preview={dashboard.sessions[0]}
          options={options}
          error=""
          onClose={onClose}
        />,
        host,
      ),
    );
    expect(host.textContent).toContain("Loading session details");
    expect(host.textContent).toContain(dashboard.sessions[0].title);
    act(() =>
      render(
        <SessionView
          detail={null}
          preview={dashboard.sessions[0]}
          options={options}
          error="offline"
          onClose={onClose}
        />,
        host,
      ),
    );
    expect(host.textContent).toContain(
      "Could not load session details: offline",
    );
    act(() => host.querySelector<HTMLButtonElement>(".session-back")?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves long action text and copies the full value", async () => {
    const longText = "Saved content ".repeat(50);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const detail = {
      session: dashboard.sessions[0],
      usage: [{ model: "model-a", tokens }],
      actions: [
        {
          id: "action",
          kind: "tool",
          label: "Run command",
          detail: longText,
          input: "command input",
          output: "command result",
          status: "completed",
          created: dashboard.sessions[0].created,
          order: 1,
        },
      ],
    };
    act(() =>
      render(
        <SessionView
          detail={detail}
          options={options}
          error=""
          onClose={vi.fn()}
        />,
        host,
      ),
    );
    expect(host.querySelector(".saved-text-collapsed")?.textContent).toBe(
      longText,
    );
    act(() =>
      host.querySelector<HTMLButtonElement>(".saved-text-toggle")?.click(),
    );
    expect(host.querySelector(".saved-text-collapsed")).toBeNull();
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="Copy action text"]')
        ?.click(),
    );
    expect(writeText).toHaveBeenCalledWith(longText);
    expect(
      host.querySelector('[aria-label="Copied action text"]'),
    ).not.toBeNull();
    expect(host.textContent).toContain("command result");
  });
});
