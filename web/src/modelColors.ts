import type { Dashboard } from "./types";

export type Theme = "default" | "claude";

export function modelColors(dashboard: Dashboard, theme: Theme) {
  const models = [
    ...new Set(dashboard.bars.flatMap((bar) => Object.keys(bar.models || {}))),
  ].sort();
  const colors = Object.fromEntries(
    models.map((model, index) => [
      model,
      model === "Unknown"
        ? theme === "claude"
          ? "#a69c8e"
          : "#92909f"
        : `hsl(${((theme === "claude" ? 22 : 265) + index * 137.5) % 360} 70% 68%)`,
    ]),
  );
  return { models, colors };
}
