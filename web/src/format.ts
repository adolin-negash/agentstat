import type { Dashboard, Tokens } from "./types";

export const emptyDashboard: Dashboard = {
  sessions: [],
  summary: {
    sessions: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  },
  bars: [],
};
export const total = (tokens: Tokens) =>
  tokens.input +
  tokens.output +
  tokens.reasoning +
  tokens.cacheRead +
  tokens.cacheWrite;
export const num = (value: number) => new Intl.NumberFormat().format(value);
export const compact = (value: number) =>
  new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
export const sourceLabel = (name: string | undefined) =>
  name === "codex"
    ? "Codex"
    : name === "copilot"
      ? "GitHub Copilot"
      : name === "opencode"
        ? "OpenCode"
        : name === "kilo"
          ? "Kilo Code"
          : "Unknown source";
export const date = (value: number | string) => {
  const local = new Date(value);
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())} ${pad(local.getHours())}:${pad(local.getMinutes())}`;
};
