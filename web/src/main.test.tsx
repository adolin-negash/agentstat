// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { date } from "./format";
import type { Dashboard, Detail, Options, Status } from "./types";

const tokens = {
  input: 3,
  output: 4,
  reasoning: 1,
  cacheRead: 2,
  cacheWrite: 0,
};
const session = {
  id: "codex/session one",
  sourceId: 1,
  projectId: "project",
  folderId: 1,
  title: "A long saved session title",
  model: "model-a",
  models: ["model-a"],
  created: new Date(2026, 0, 2, 3, 4).getTime(),
  updated: new Date(2026, 0, 2, 3, 4).getTime(),
  actionCount: 2,
  toolCalls: 1,
  tokens,
};
const options: Options = {
  projects: [{ id: "project", name: "Project" }],
  folders: [{ id: 1, path: "/project" }],
  models: ["model-a"],
  sources: [{ id: 1, name: "codex" }],
};
const status: Status = {
  version: "v1.2.3",
  serverAddress: "127.0.0.1:8080",
  databasePath: "/data/agentstat.db",
  source: "/sources/opencode.db",
  codexSource: "/sources/codex",
  copilotSource: "/sources/copilot",
  kiloSource: "/sources/kilo.db",
  lastImport: "2026-01-02T03:04:00Z",
  importedSessions: 0,
  importError: "",
  sessions: 1,
};
const dashboard: Dashboard = {
  sessions: [session],
  summary: { sessions: 1, tokens },
  bars: [
    { date: "2026-01-02", sessions: 1, tokens: 10, models: { "model-a": 10 } },
  ],
};
const detail: Detail = {
  session,
  actions: [],
  usage: [{ model: "model-a", tokens }],
};

let host: HTMLDivElement;
const stored = new Map<string, string>();
beforeEach(() => {
  vi.resetModules();
  stored.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => stored.set(key, value),
  });
  host = document.createElement("div");
  host.id = "app";
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

function reply(value: unknown, statusCode = 200) {
  return {
    ok: statusCode < 400,
    json: async () => value,
    text: async () => JSON.stringify(value),
  };
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("app requests and states", () => {
  it("opens the sessions dashboard by default and switches views", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input === "/api/options") return reply(options);
        if (input === "/api/status") return reply({ ...status, sessions: 42 });
        if (input.startsWith("/api/dashboard")) return reply(dashboard);
        throw new Error(`Unexpected request: ${input}`);
      }),
    );
    await act(async () => {
      await import("./main");
    });
    await settle();

    const navigation = host.querySelector(".sidebar nav")!;
    const sessions = navigation.querySelector<HTMLButtonElement>(
      "button:nth-child(1)",
    )!;
    const projects = navigation.querySelector<HTMLButtonElement>(
      "button:nth-child(2)",
    )!;
    const settings = navigation.querySelector<HTMLButtonElement>(
      "button:nth-child(3)",
    )!;
    expect(sessions.getAttribute("aria-current")).toBe("page");
    expect(host.querySelector("main h1")?.textContent).toBe("Sessions");
    expect(host.querySelector("main h1 svg path")?.getAttribute("d")).toBe(
      sessions.querySelector("svg path")?.getAttribute("d"),
    );
    expect(host.querySelector(".sessions-panel")).not.toBeNull();
    expect(host.querySelector(".topbar .theme-picker")).toBeNull();
    expect(host.querySelector(".topbar .refresh")).toBeNull();
    expect(host.querySelector(".side-bottom")?.textContent).toBe(
      "42 sessions indexedVersion v1.2.3",
    );

    await act(async () => projects.click());
    await settle();
    expect(projects.getAttribute("aria-current")).toBe("page");
    expect(host.querySelector("main h1")?.textContent).toBe("Projects");
    expect(projects.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 14 14",
    );
    expect(projects.querySelector("svg path")?.getAttribute("d")).toBe(
      "M7,1V5h4V1Zm3,3H8V2h2ZM7,7v4h4V7Zm3,3H8V8h2ZM1,1V5H5V1ZM4,4H2V2H4ZM1,7v4H5V7Zm3,3H2V8H4Z",
    );
    expect(host.querySelector("main h1 svg path")?.getAttribute("d")).toBe(
      projects.querySelector("svg path")?.getAttribute("d"),
    );
    expect(host.querySelector(".project-row")?.textContent).toContain(
      "Project",
    );
    expect(host.querySelector(".sessions-panel")).toBeNull();
    expect(host.querySelector(".filter-panel")).toBeNull();

    await act(async () => settings.click());
    expect(settings.getAttribute("aria-current")).toBe("page");
    expect(settings.querySelector("svg")).not.toBeNull();
    expect(settings.querySelector("svg circle")?.getAttribute("cx")).toBe("12");
    expect(settings.querySelector("svg circle")?.getAttribute("cy")).toBe("12");
    expect(host.querySelector("main h1")?.textContent).toBe("Settings");
    expect(host.querySelector("main h1 svg path")?.getAttribute("d")).toBe(
      settings.querySelector("svg path")?.getAttribute("d"),
    );
    expect(host.querySelector(".side-bottom")?.textContent).toContain(
      "42 sessions indexed",
    );
    const settingRows = host.querySelectorAll(".settings-row");
    expect(settingRows).toHaveLength(2);
    expect(settingRows[0].textContent).toContain("Theme");
    expect(settingRows[0].querySelector("select")).not.toBeNull();
    expect(settingRows[1].textContent).toContain("Data reload");
    expect(settingRows[1].querySelector("button")?.textContent).toBe(
      "Refresh data",
    );

    await act(async () => sessions.click());
    expect(sessions.getAttribute("aria-current")).toBe("page");
    expect(host.querySelector(".sessions-panel")).not.toBeNull();
  });

  it("sorts projects by name and opens every project session", async () => {
    const earlier = {
      ...session,
      id: "first",
      created: session.created - 86_400_000,
      folderId: 2,
      actionCount: 4,
      toolCalls: 2,
      tokens: {
        input: 5,
        output: 7,
        reasoning: 2,
        cacheRead: 3,
        cacheWrite: 1,
      },
    };
    const later = {
      ...session,
      id: "later",
      sourceId: 2,
      created: session.created + 86_400_000,
      actionCount: 6,
      toolCalls: 3,
    };
    const other = {
      ...session,
      id: "other",
      projectId: "alpha",
      folderId: 3,
      tokens: {
        input: 1,
        output: 1,
        reasoning: 0,
        cacheRead: 0,
        cacheWrite: 0,
      },
    };
    const all = { ...dashboard, sessions: [session, earlier, later, other] };
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        requests.push(input);
        if (input === "/api/options")
          return reply({
            ...options,
            projects: [
              { id: "project", name: "Zeta project" },
              { id: "alpha", name: "Alpha project" },
            ],
            folders: [
              ...options.folders,
              { id: 2, path: "/second/folder" },
              { id: 3, path: "/alpha" },
            ],
            sources: [...options.sources, { id: 2, name: "opencode" }],
          });
        if (input === "/api/status") return reply(status);
        if (input === "/api/dashboard") return reply(all);
        if (input.startsWith("/api/dashboard?"))
          return reply({ ...dashboard, sessions: [] });
        if (input === "/api/sessions/first")
          return reply({ ...detail, session: earlier });
        throw new Error(`Unexpected request: ${input}`);
      }),
    );
    await act(async () => {
      await import("./main");
    });
    await settle();
    const name = host.querySelector<HTMLInputElement>(
      ".session-name-filter input",
    )!;
    await act(async () => {
      name.value = "missing";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(requests).toContain("/api/dashboard?name=missing");
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(".sidebar nav button:nth-child(2)")!
        .click(),
    );
    await settle();
    const rows = [...host.querySelectorAll<HTMLButtonElement>(".project-row")];
    expect(rows.map((row) => row.querySelector("strong")?.textContent)).toEqual(
      ["Alpha project", "Zeta project"],
    );
    expect(rows[1].textContent).toContain(date(earlier.created));
    expect(rows[1].textContent).toContain(date(later.created));
    expect(rows[1].textContent).toContain("3");
    expect(rows[1].textContent).toContain("38");
    expect(rows[1].textContent).toContain("19");
    expect(rows[1].textContent).toContain("11");
    expect(rows[1].textContent).toContain("15");
    expect(rows[1].textContent).toContain("Codex, OpenCode");
    expect(
      rows[0].querySelector(".project-folder")?.getAttribute("title"),
    ).toBe("/alpha");
    expect(
      rows[1].querySelector(".project-folder")?.getAttribute("title"),
    ).toBe("/project");
    expect(rows[1].lastElementChild?.classList.contains("project-folder")).toBe(
      true,
    );
    const heading = (label: string) =>
      [
        ...host.querySelectorAll<HTMLButtonElement>(
          ".project-list-head button",
        ),
      ].find((button) => button.textContent?.includes(label))!;
    expect(
      host.querySelector(".project-list-head")?.lastElementChild?.textContent,
    ).toContain("Folder");
    expect(heading("Name").parentElement?.getAttribute("aria-sort")).toBe(
      "ascending",
    );
    await act(async () => heading("Source").click());
    expect(heading("Source").parentElement?.getAttribute("aria-sort")).toBe(
      "ascending",
    );
    await act(async () => heading("Source").click());
    expect(host.querySelector(".project-row strong")?.textContent).toBe(
      "Zeta project",
    );
    await act(async () => heading("Folder").click());
    expect(heading("Folder").parentElement?.getAttribute("aria-sort")).toBe(
      "ascending",
    );
    expect(host.querySelector(".project-row strong")?.textContent).toBe(
      "Alpha project",
    );
    await act(async () => heading("Total tokens").click());
    expect(
      heading("Total tokens").parentElement?.getAttribute("aria-sort"),
    ).toBe("ascending");
    await act(async () => heading("Total tokens").click());
    expect(
      heading("Total tokens").parentElement?.getAttribute("aria-sort"),
    ).toBe("descending");
    expect(host.querySelector(".project-row strong")?.textContent).toBe(
      "Zeta project",
    );
    await act(async () => heading("Name").click());
    expect(
      heading("Total tokens").parentElement?.getAttribute("aria-sort"),
    ).toBe("none");
    expect(host.querySelector(".project-row strong")?.textContent).toBe(
      "Alpha project",
    );
    await act(async () => rows[1].click());
    expect(host.querySelectorAll(".project-detail .session-row")).toHaveLength(
      3,
    );
    const properties = host.querySelector(".project-properties")!;
    expect(properties.textContent).toContain("SourceCodex, OpenCode");
    expect(properties.textContent).toContain("/project, /second/folder");
    expect(properties.textContent).toContain("Total actions12");
    expect(properties.textContent).toContain("Mean tokens / session12.7");
    expect(properties.textContent).toContain("Mean actions / session4");
    expect(properties.textContent).toContain("Mean tool calls / session2");
    await act(async () =>
      host
        .querySelectorAll<HTMLButtonElement>(".project-detail .session-row")[1]
        .click(),
    );
    await settle();
    expect(requests).toContain("/api/sessions/first");
    expect(host.querySelector(".session-view")).not.toBeNull();
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".session-back")!.click(),
    );
    expect(host.querySelector(".project-detail")).not.toBeNull();
    expect(
      host.querySelector(".project-back svg.back-icon path")?.getAttribute("d"),
    ).toBe("m15 18-6-6 6-6");
    expect(
      host.querySelector(".project-back")?.getAttribute("aria-label"),
    ).toBe("Back to projects");
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".project-back")!.click(),
    );
    expect(host.querySelectorAll(".project-row")).toHaveLength(2);
  });

  it("shows empty and error states in Projects", async () => {
    let failProjects = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input === "/api/options") return reply(options);
        if (input === "/api/status") return reply(status);
        if (input === "/api/dashboard")
          return failProjects
            ? reply({ error: "projects unavailable" }, 500)
            : reply({ ...dashboard, sessions: [] });
        throw new Error(`Unexpected request: ${input}`);
      }),
    );
    await act(async () => {
      await import("./main");
    });
    await settle();
    const navigation = host.querySelectorAll<HTMLButtonElement>(
      ".sidebar nav button",
    );
    await act(async () => navigation[1].click());
    await settle();
    expect(host.textContent).toContain("No projects imported yet");
    failProjects = true;
    await act(async () => navigation[0].click());
    await act(async () => navigation[1].click());
    await settle();
    expect(host.textContent).toContain("projects unavailable");
    expect(host.querySelector(".project-row")).toBeNull();
  });

  it("shows configured paths when the sidebar version is clicked and closes the dialog", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input === "/api/options") return reply(options);
        if (input === "/api/status") return reply(status);
        if (input.startsWith("/api/dashboard")) return reply(dashboard);
        throw new Error(`Unexpected request: ${input}`);
      }),
    );
    await act(async () => {
      await import("./main");
    });
    await settle();

    const trigger = host.querySelector<HTMLButtonElement>(".version-trigger")!;
    await act(async () => trigger.click());
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.textContent).toContain("Last successful import");
    expect(dialog.textContent).toContain(date(status.lastImport));
    expect(document.activeElement).toBe(
      host.querySelector<HTMLButtonElement>(".version-close"),
    );
    for (const value of [
      "v1.2.3",
      "127.0.0.1:8080",
      "/data/agentstat.db",
      "/sources/opencode.db",
      "/sources/codex",
      "/sources/copilot",
      "/sources/kilo.db",
    ]) {
      expect(dialog.textContent).toContain(value);
    }
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".version-close")!.click(),
    );
    expect(host.querySelector('[role="dialog"]')).toBeNull();

    await act(async () => trigger.click());
    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("loads the dashboard, applies filters, opens details, and reloads data in Settings", async () => {
    const requests: string[] = [];
    let importCount = 3;
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      requests.push(`${init?.method || "GET"} ${input}`);
      if (input === "/api/options") return reply(options);
      if (input === "/api/status") return reply(status);
      if (input === "/api/import")
        return reply({ ...status, importedSessions: importCount });
      if (input.startsWith("/api/dashboard")) return reply(dashboard);
      if (input === "/api/sessions/codex%2Fsession%20one") return reply(detail);
      throw new Error(`Unexpected request: ${input}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    await act(async () => {
      await import("./main");
    });
    await settle();

    expect(host.textContent).toContain(session.title);
    expect(host.querySelector("footer")).toBeNull();
    const name = host.querySelector<HTMLInputElement>(
      ".session-name-filter input",
    )!;
    await act(async () => {
      name.value = "  saved  ";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(requests).toContain("GET /api/dashboard?name=saved");
    const regex = host.querySelector<HTMLButtonElement>(
      '[aria-label="Regular expression"]',
    )!;
    const caseSensitive = host.querySelector<HTMLButtonElement>(
      '[aria-label="Case sensitive"]',
    )!;
    expect(regex.getAttribute("aria-pressed")).toBe("false");
    expect(caseSensitive.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      regex.click();
      caseSensitive.click();
    });
    await settle();
    expect(regex.getAttribute("aria-pressed")).toBe("true");
    expect(caseSensitive.getAttribute("aria-pressed")).toBe("true");
    expect(requests).toContain(
      "GET /api/dashboard?name=saved&regex=1&case_sensitive=1",
    );

    await act(async () =>
      host.querySelector<HTMLButtonElement>(".session-row")!.click(),
    );
    await settle();
    expect(requests).toContain("GET /api/sessions/codex%2Fsession%20one");
    expect(host.querySelector(".session-view")?.textContent).toContain(
      session.title,
    );
    expect(
      host.querySelector(".session-back svg.back-icon path")?.getAttribute("d"),
    ).toBe("m15 18-6-6 6-6");
    expect(
      host.querySelector(".session-back")?.getAttribute("aria-label"),
    ).toBe("Back to previous view");
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".session-back")!.click(),
    );
    expect(host.querySelector(".session-view")).toBeNull();
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(".sidebar nav button:nth-child(3)")!
        .click(),
    );
    expect(host.querySelector(".refresh")).not.toBeNull();

    const timerSpy = vi.spyOn(window, "setTimeout");
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".refresh")!.click(),
    );
    await settle();
    expect(requests).toContain("POST /api/import");
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "3 Sessions imported",
    );
    const expiry = timerSpy.mock.calls.find(
      ([, delay]) => delay === 10_000,
    )?.[0];
    expect(expiry).toBeTypeOf("function");
    if (typeof expiry !== "function") throw new Error("missing popup timer");
    await act(async () => expiry());
    expect(host.querySelector('[role="status"]')).toBeNull();
    timerSpy.mockRestore();
    expect(
      requests.filter(
        (request) =>
          request === "GET /api/dashboard?name=saved&regex=1&case_sensitive=1",
      ),
    ).toHaveLength(2);

    importCount = 0;
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".refresh")!.click(),
    );
    await settle();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Nothing to import",
    );
  });

  it("shows request failures and keeps theme selection usable", async () => {
    localStorage.setItem("agentstat-theme", "claude");
    let failImport = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        if (input === "/api/options") return reply(options);
        if (input === "/api/status")
          return reply({ ...status, importError: "source unavailable" });
        if (input === "/api/import")
          return failImport
            ? reply({ error: "import failed" }, 500)
            : reply(status);
        if (input.startsWith("/api/dashboard"))
          return reply({ error: "dashboard failed" }, 500);
        throw new Error(`Unexpected request: ${input}`);
      }),
    );
    await act(async () => {
      await import("./main");
    });
    await settle();
    expect(document.documentElement.dataset.theme).toBe("claude");
    expect(host.textContent).toContain("Import issue: source unavailable");
    expect(host.textContent).toContain("dashboard failed");
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(".sidebar nav button:nth-child(3)")!
        .click(),
    );
    const theme = host.querySelector<HTMLSelectElement>(
      ".theme-picker select",
    )!;
    await act(async () => {
      theme.value = "default";
      theme.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(localStorage.getItem("agentstat-theme")).toBe("default");
    failImport = true;
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".refresh")!.click(),
    );
    await settle();
    expect(host.textContent).toContain("import failed");
    expect(host.querySelector<HTMLButtonElement>(".refresh")!.disabled).toBe(
      false,
    );
  });
});
