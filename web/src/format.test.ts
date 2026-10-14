import { describe, expect, it } from "vitest";
import { compact, date, emptyDashboard, num, total } from "./format";

describe("dashboard formatting", () => {
  it("starts with independent empty collections and zero totals", () => {
    expect(emptyDashboard.sessions).toEqual([]);
    expect(emptyDashboard.bars).toEqual([]);
    expect(total(emptyDashboard.summary.tokens)).toBe(0);
  });

  it("counts every displayed token category exactly once", () => {
    expect(
      total({
        input: 10,
        output: 20,
        reasoning: 3,
        cacheRead: 7,
        cacheWrite: 2,
      }),
    ).toBe(42);
  });

  it("formats numbers with the active locale", () => {
    expect(num(12345)).toBe(new Intl.NumberFormat().format(12345));
    expect(compact(1200)).toBe(
      new Intl.NumberFormat(undefined, {
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(1200),
    );
  });

  it("formats local date and time with padded parts", () => {
    const value = new Date(2026, 0, 2, 3, 4);
    expect(date(value.getTime())).toBe("2026-01-02 03:04");
    expect(date(value.toISOString())).toBe("2026-01-02 03:04");
  });
});
