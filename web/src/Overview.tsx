import { useRef, useState } from "preact/hooks";
import { compact, num, total } from "./format";
import { modelColors, type Theme } from "./modelColors";
import type { Dashboard } from "./types";

type Props = {
  dashboard: Dashboard;
  theme: Theme;
  from: string;
  to: string;
  selectedModels: string[];
  onRange: (from: string, to: string) => void;
  onModels: (models: string[]) => void;
};

function localMidnight(day: string, nextDay = false) {
  const [year, month, date] = day.split("-").map(Number);
  const value = new Date(year, month - 1, date + Number(nextDay));
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T00:00`;
}

function dateGroups(dates: string[], keyLength: number) {
  const groups: { key: string; start: number; end: number }[] = [];
  dates.forEach((date, index) => {
    const key = date.slice(0, keyLength);
    const last = groups[groups.length - 1];
    if (last?.key === key) last.end = index + 1;
    else groups.push({ key, start: index, end: index + 1 });
  });
  return groups;
}

export function Overview({
  dashboard,
  theme,
  from,
  to,
  selectedModels,
  onRange,
  onModels,
}: Props) {
  const max = Math.max(1, ...dashboard.bars.map((bar) => bar.tokens));
  const dates = dashboard.bars.map((bar) => bar.date);
  const months = dateGroups(dates, 7);
  const years = dateGroups(dates, 4);
  const { models, colors } = modelColors(dashboard, theme);
  const drag = useRef<{ start: number; end: number } | null>(null);
  const [preview, setPreview] = useState<{ start: number; end: number } | null>(
    null,
  );
  const [expanded, setExpanded] = useState(true);

  const select = (start: number, end: number) => {
    const first = dashboard.bars[Math.min(start, end)];
    const last = dashboard.bars[Math.max(start, end)];
    if (first && last)
      onRange(localMidnight(first.date), localMidnight(last.date, true));
    drag.current = null;
    setPreview(null);
  };

  const indexAt = (x: number, container: HTMLDivElement) => {
    const slots = container.querySelectorAll<HTMLElement>(".bar-slot");
    let closest = 0;
    let distance = Infinity;
    slots.forEach((slot, index) => {
      const bounds = slot.getBoundingClientRect();
      const gap = Math.abs(x - (bounds.left + bounds.right) / 2);
      if (gap < distance) {
        distance = gap;
        closest = index;
      }
    });
    return closest;
  };

  return (
    <section id="overview" class="chart-panel">
      <div class="section-head">
        <div>
          <h2>
            <button
              type="button"
              class="overview-title"
              aria-expanded={expanded}
              aria-controls="overview-chart"
              onClick={() => setExpanded(!expanded)}
            >
              Token usage over time
            </button>
          </h2>
          {expanded && (
            <p>
              Click a day, drag across days, or select a model to filter
              sessions
            </p>
          )}
        </div>
        <div class="overview-actions">
          {(from || to || selectedModels.length > 0) && (
            <button
              type="button"
              class="chart-clear"
              onClick={() => {
                onRange("", "");
                onModels([]);
              }}
            >
              Clear
            </button>
          )}
          <button
            type="button"
            class="overview-toggle"
            aria-expanded={expanded}
            aria-controls="overview-chart"
            aria-label={expanded ? "Collapse overview" : "Expand overview"}
            title={expanded ? "Collapse overview" : "Expand overview"}
            onClick={() => setExpanded(!expanded)}
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d={expanded ? "m5 12 5-5 5 5" : "m5 8 5 5 5-5"} />
            </svg>
          </button>
        </div>
      </div>
      <div id="overview-chart" hidden={!expanded}>
        {dashboard.bars.length ? (
          <>
            <div class="chart-legend" aria-label="Models">
              {models.map((model) => (
                <button
                  type="button"
                  key={model}
                  class={selectedModels.includes(model) ? "selected" : ""}
                  aria-pressed={selectedModels.includes(model)}
                  onClick={() =>
                    onModels(
                      selectedModels.length === 1 && selectedModels[0] === model
                        ? []
                        : [model],
                    )
                  }
                >
                  <i style={{ backgroundColor: colors[model] }} />
                  {model}
                </button>
              ))}
            </div>
            <div class="chart">
              <div class="gridlines">
                <span>{compact(max)}</span>
                <span>{compact(max / 2)}</span>
                <span>0</span>
              </div>
              <div
                class="bars"
                onPointerDown={(event) => {
                  const slot = (event.target as Element).closest<HTMLElement>(
                    ".bar-slot",
                  );
                  if (!slot) return;
                  const end = Number(slot.dataset.index);
                  const start = end;
                  drag.current = { start, end };
                  setPreview({ start, end });
                  event.currentTarget.setPointerCapture(event.pointerId);
                }}
                onPointerMove={(event) => {
                  if (!drag.current) return;
                  const end = indexAt(event.clientX, event.currentTarget);
                  drag.current.end = end;
                  setPreview({ ...drag.current });
                }}
                onPointerUp={(event) => {
                  if (!drag.current) return;
                  const { start } = drag.current;
                  select(start, indexAt(event.clientX, event.currentTarget));
                }}
                onPointerCancel={() => {
                  drag.current = null;
                  setPreview(null);
                }}
              >
                <div
                  class="bar-grid"
                  style={{
                    gridTemplateColumns: `repeat(${dashboard.bars.length}, minmax(24px, 1fr))`,
                  }}
                >
                  {dashboard.bars.map((bar, index) => (
                    <button
                      type="button"
                      key={bar.date}
                      data-index={index}
                      class={`bar-slot${preview && index >= Math.min(preview.start, preview.end) && index <= Math.max(preview.start, preview.end) ? " range-preview" : ""}`}
                      style={{ gridColumn: index + 1 }}
                      title={`${bar.date}: ${num(bar.tokens)} tokens · ${bar.sessions} sessions`}
                      aria-label={`${bar.date}, ${num(bar.tokens)} tokens, ${bar.sessions} sessions. Select day.`}
                      onClick={(event) => {
                        if (event.detail === 0) select(index, index);
                      }}
                    >
                      <span
                        class={`bar-stack${bar.tokens === 0 ? " zero-usage" : ""}`}
                        style={{
                          height: `max(${Math.max(12, Object.values(bar.models || {}).filter((tokens) => tokens > 0).length * 4)}px, ${(bar.tokens / max) * 100}%)`,
                        }}
                      >
                        {models
                          .filter((model) => bar.models?.[model])
                          .map((model) => (
                            <i
                              key={model}
                              style={{
                                backgroundColor: colors[model],
                                flexGrow: bar.models[model],
                              }}
                              title={`${model}: ${num(bar.models[model])} tokens`}
                            />
                          ))}
                      </span>
                    </button>
                  ))}
                  {dashboard.bars.map((bar, index) => (
                    <span
                      class="axis-day"
                      key={`day-${bar.date}`}
                      style={{ gridColumn: index + 1 }}
                      aria-hidden="true"
                    >
                      {Number(bar.date.slice(8))}
                    </span>
                  ))}
                  {months.map((month) => (
                    <span
                      class={`axis-month${month.start ? " axis-boundary" : ""}`}
                      key={month.key}
                      style={{
                        gridColumn: `${month.start + 1} / ${month.end + 1}`,
                      }}
                      aria-hidden="true"
                    >
                      {new Intl.DateTimeFormat(undefined, {
                        month: "short",
                      }).format(new Date(`${month.key}-01T00:00`))}
                    </span>
                  ))}
                  {years.map((year) => (
                    <span
                      class={`axis-year${year.start ? " axis-boundary" : ""}`}
                      key={year.key}
                      style={{
                        gridColumn: `${year.start + 1} / ${year.end + 1}`,
                      }}
                      aria-hidden="true"
                    >
                      {year.key}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div class="empty-chart">
            No usage in this range. Adjust the filters or refresh the import.
          </div>
        )}
      </div>
    </section>
  );
}

export function SessionSummary({ dashboard }: { dashboard: Dashboard }) {
  return (
    <>
      <section class="metrics" aria-label="Session summary">
        <div class="metric">
          <span>SESSIONS</span>
          <strong>{num(dashboard.summary.sessions)}</strong>
          <small>In selected range</small>
        </div>
        <div class="metric">
          <span>TOTAL TOKENS</span>
          <strong>{compact(total(dashboard.summary.tokens))}</strong>
          <small>{num(total(dashboard.summary.tokens))} incl. cached</small>
        </div>
        <div class="metric">
          <span>UNCACHED INPUT</span>
          <strong>{compact(dashboard.summary.tokens.input)}</strong>
          <small>Prompts and context</small>
        </div>
        <div class="metric">
          <span>OUTPUT TOKENS</span>
          <strong>{compact(dashboard.summary.tokens.output)}</strong>
          <small>Excludes reasoning</small>
        </div>
        <div class="metric">
          <span>CACHED INPUT</span>
          <strong>{compact(dashboard.summary.tokens.cacheRead)}</strong>
          <small>
            {num(dashboard.summary.tokens.cacheRead)} read ·{" "}
            {num(dashboard.summary.tokens.cacheWrite)} written
          </small>
        </div>
      </section>
    </>
  );
}
