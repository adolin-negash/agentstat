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
      actionCount: 0,
      toolCalls: 0,
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
            theme="default"
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
          theme="default"
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

  it("colors each session model like the overview in both themes", () => {
    const multiModelDashboard: Dashboard = {
      ...dashboard,
      sessions: [{ ...dashboard.sessions[0], models: ["model-a", "model-b"] }],
      bars: [
        {
          ...dashboard.bars[0],
          models: { "model-a": 5, "model-b": 5 },
        },
      ],
    };
    for (const theme of ["default", "claude"] as const) {
      act(() =>
        render(
          <>
            <Overview
              dashboard={multiModelDashboard}
              theme={theme}
              from=""
              to=""
              selectedModels={[]}
              onRange={vi.fn()}
              onModels={vi.fn()}
            />
            <SessionList
              dashboard={multiModelDashboard}
              theme={theme}
              options={options}
              onSelect={vi.fn()}
            />
          </>,
          host,
        ),
      );
      const legendColors = [
        ...host.querySelectorAll<HTMLElement>(".chart-legend i"),
      ].map((element) => element.style.backgroundColor);
      const sessionColors = [
        ...host.querySelectorAll<HTMLElement>(".session-model span[style]"),
      ].map((element) => element.style.color);
      expect(sessionColors).toEqual(legendColors);
    }
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

  it("starts with the overview expanded and folds and unfolds the chart", () => {
    act(() =>
      render(
        <Overview
          dashboard={dashboard}
          theme="default"
          from=""
          to=""
          selectedModels={[]}
          onRange={vi.fn()}
          onModels={vi.fn()}
        />,
        host,
      ),
    );
    const toggle = host.querySelector<HTMLButtonElement>(".overview-toggle")!;
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-label")).toBe("Collapse overview");
    expect(host.querySelectorAll(".bar-slot")).toHaveLength(2);
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.getAttribute("aria-label")).toBe("Expand overview");
    expect(host.querySelector("#overview-chart")?.hasAttribute("hidden")).toBe(
      true,
    );
    const title = host.querySelector<HTMLButtonElement>(".overview-title")!;
    act(() => title.click());
    expect(title.getAttribute("aria-expanded")).toBe("true");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("#overview-chart")?.hasAttribute("hidden")).toBe(
      false,
    );
    expect(host.querySelectorAll(".bar-slot")).toHaveLength(2);
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
    onRegex: vi.fn(),
    onCaseSensitive: vi.fn(),
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
          regex={false}
          caseSensitive={false}
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
    expect(on.onRegex).toHaveBeenCalledWith(false);
    expect(on.onCaseSensitive).toHaveBeenCalledWith(false);
    expect(on.onFrom).toHaveBeenLastCalledWith("");
  });

  it("searches and selects choices, then closes pickers from outside and Escape", () => {
    const on = handlers();
    const manyOptions: Options = {
      ...options,
      projects: Array.from({ length: 6 }, (_, index) => ({
        id: `project-${index}`,
        name: `Project ${index}`,
      })),
    };
    const show = (projects: string[]) =>
      act(() =>
        render(
          <Filters
            options={manyOptions}
            projects={projects}
            models={[]}
            sources={[]}
            name=""
            regex={false}
            caseSensitive={false}
            from=""
            to=""
            {...on}
          />,
          host,
        ),
      );
    show([]);
    const picker = host.querySelector<HTMLDetailsElement>(
      ".multi-select-filter:has(.filter-search) details",
    )!;
    act(() => {
      picker.open = true;
      picker.dispatchEvent(new Event("toggle"));
    });
    const search = picker.querySelector<HTMLInputElement>(".filter-search")!;
    act(() => {
      search.value = "Project 4";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(picker.querySelectorAll('input[type="checkbox"]')).toHaveLength(1);
    act(() =>
      picker.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    expect(on.onProjects).toHaveBeenLastCalledWith(["project-4"]);
    show(["project-4"]);
    expect(picker.querySelector("summary")?.textContent).toBe("Project 4");
    act(() =>
      picker.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click(),
    );
    expect(on.onProjects).toHaveBeenLastCalledWith([]);
    act(() =>
      picker
        .querySelector<HTMLButtonElement>(".filter-options button")!
        .click(),
    );
    expect(on.onProjects).toHaveBeenLastCalledWith([]);
    act(() => {
      document.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(picker.open).toBe(false);
    act(() => {
      picker.open = true;
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(picker.open).toBe(false);
    expect(document.activeElement).toBe(picker.querySelector("summary"));
  });

  it("updates search controls and date pickers", () => {
    const on = handlers();
    act(() =>
      render(
        <Filters
          options={options}
          projects={[]}
          models={[]}
          sources={[]}
          name=""
          regex={false}
          caseSensitive={false}
          from="2026-01-02T03:04"
          to=""
          {...on}
        />,
        host,
      ),
    );
    const name = host.querySelector<HTMLInputElement>("#session-name-search")!;
    act(() => {
      name.value = "review";
      name.dispatchEvent(new Event("input", { bubbles: true }));
      host
        .querySelector<HTMLButtonElement>('[aria-label="Regular expression"]')!
        .click();
      host
        .querySelector<HTMLButtonElement>('[aria-label="Case sensitive"]')!
        .click();
    });
    expect(on.onName).toHaveBeenCalledWith("review");
    expect(on.onRegex).toHaveBeenCalledWith(true);
    expect(on.onCaseSensitive).toHaveBeenCalledWith(true);
    const picker = host.querySelector<HTMLInputElement>(
      '[aria-label="Choose to date and time"]',
    )!;
    act(() => {
      picker.value = "2026-01-03T00:00";
      picker.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(on.onTo).toHaveBeenCalledWith("2026-01-03T00:00");
    act(() =>
      host
        .querySelector<HTMLButtonElement>(
          '[aria-label="Clear from date and time"]',
        )!
        .click(),
    );
    expect(on.onFrom).toHaveBeenCalledWith("");
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

  it("searches labels, saved text, and nested tool details", () => {
    const detail = {
      session: dashboard.sessions[0],
      usage: [],
      actions: [
        {
          id: "prompt",
          kind: "user",
          label: "Question",
          detail: `${"Earlier prompt text ".repeat(35)}Find the orchid`,
          created: dashboard.sessions[0].created,
          order: 1,
        },
        {
          id: "tool-parent",
          kind: "assistant",
          label: "Assistant step",
          created: dashboard.sessions[0].created,
          order: 2,
        },
        {
          id: "tool-child",
          parentId: "tool-parent",
          kind: "tool",
          label: "Inspect file",
          input: "needle in input",
          output: "needle in result",
          created: dashboard.sessions[0].created,
          order: 3,
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
    const input = host.querySelector<HTMLInputElement>(".action-search input")!;
    const search = (value: string) =>
      act(() => {
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });

    search("ORCHID");
    expect(host.querySelectorAll(".action")).toHaveLength(1);
    expect(host.textContent).toContain("Question");
    expect(host.textContent).toContain("1 of 3 actions match");
    expect(host.querySelector(".saved-text-collapsed")).toBeNull();
    expect(host.querySelector(".saved-text mark")?.textContent).toBe("orchid");

    search("needle in result");
    expect(host.querySelectorAll(".action")).toHaveLength(1);
    expect(host.querySelector(".child[open]")).not.toBeNull();
    expect(host.textContent).toContain("Assistant step");
    expect(host.textContent).toContain("needle in result");
    expect(host.querySelector(".child .saved-text mark")?.textContent).toBe(
      "needle in result",
    );

    search("inspect file");
    expect(host.querySelector(".child[open]")).not.toBeNull();
    expect(host.querySelector(".child summary mark")?.textContent).toBe(
      "Inspect file",
    );
    search("absent");
    expect(host.querySelectorAll(".action")).toHaveLength(0);
    expect(host.textContent).toContain("No matching actions");
    search("");
    expect(host.querySelectorAll(".action")).toHaveLength(2);
  });
});
