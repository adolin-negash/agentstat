// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  source: "",
  codexSource: "",
  copilotSource: "",
  kiloSource: "",
  lastImport: "2026-01-02T03:04:00Z",
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
  it("loads the dashboard, applies filters, opens details, and refreshes the selected session", async () => {
    const requests: string[] = [];
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      requests.push(`${init?.method || "GET"} ${input}`);
      if (input === "/api/options") return reply(options);
      if (input === "/api/status") return reply(status);
      if (input === "/api/import") return reply(status);
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
    expect(host.textContent).toContain("Agent Stats v1.2.3");
    const name = host.querySelector<HTMLInputElement>(
      ".session-name-filter input",
    )!;
    await act(async () => {
      name.value = "  saved  ";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
    expect(requests).toContain("GET /api/dashboard?name=saved");

    await act(async () =>
      host.querySelector<HTMLButtonElement>(".session-row")!.click(),
    );
    await settle();
    expect(requests).toContain("GET /api/sessions/codex%2Fsession%20one");
    expect(host.querySelector(".session-view")?.textContent).toContain(
      session.title,
    );

    await act(async () =>
      host.querySelector<HTMLButtonElement>(".refresh")!.click(),
    );
    await settle();
    expect(requests).toContain("POST /api/import");
    expect(
      requests.filter(
        (request) => request === "GET /api/sessions/codex%2Fsession%20one",
      ),
    ).toHaveLength(2);
    await act(async () =>
      host.querySelector<HTMLButtonElement>(".session-back")!.click(),
    );
    expect(host.querySelector(".session-view")).toBeNull();
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
