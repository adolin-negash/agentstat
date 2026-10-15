import { useEffect, useState } from "preact/hooks";
import { date, num, total } from "./format";
import type { Action, Detail, Options, Session } from "./types";
import { BackIcon } from "./BackIcon";

function HighlightedText({ text, search }: { text: string; search: string }) {
  if (!search) return <>{text}</>;
  const lower = text.toLowerCase();
  const chunks: { text: string; matched: boolean }[] = [];
  let start = 0;
  let index = lower.indexOf(search);
  while (index !== -1) {
    if (index > start)
      chunks.push({ text: text.slice(start, index), matched: false });
    chunks.push({
      text: text.slice(index, index + search.length),
      matched: true,
    });
    start = index + search.length;
    index = lower.indexOf(search, start);
  }
  if (start < text.length)
    chunks.push({ text: text.slice(start), matched: false });
  return (
    <>
      {chunks.map((chunk) =>
        chunk.matched ? (
          <mark class="search-highlight">{chunk.text}</mark>
        ) : (
          chunk.text
        ),
      )}
    </>
  );
}

function SavedText({
  text,
  label,
  search,
  copyable = true,
}: {
  text: string;
  label: string;
  search: string;
  copyable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  useEffect(() => setCopyStatus("idle"), [text]);
  useEffect(() => {
    setOpen(Boolean(search && text.toLowerCase().includes(search)));
  }, [search, text]);
  const isLong = text.length > 500 || text.split("\n").length > 8;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };
  return (
    <div class="saved-text">
      <pre class={isLong && !open ? "saved-text-collapsed" : ""}>
        <HighlightedText text={text} search={search} />
      </pre>
      {(isLong || copyable) && (
        <div class="saved-text-controls">
          {isLong && (
            <button
              type="button"
              class="saved-text-toggle"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
            >
              {open ? "Show less" : "Show more"}
            </button>
          )}
          {copyable && (
            <button
              type="button"
              class={`saved-text-copy ${copyStatus}`}
              aria-label={
                copyStatus === "copied"
                  ? `Copied ${label}`
                  : copyStatus === "failed"
                    ? `Copy ${label} failed; retry`
                    : `Copy ${label}`
              }
              title={
                copyStatus === "copied"
                  ? "Copied"
                  : copyStatus === "failed"
                    ? "Copy failed — retry"
                    : `Copy ${label}`
              }
              aria-live="polite"
              onClick={copy}
            >
              <svg
                aria-hidden="true"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                {copyStatus === "copied" ? (
                  <path d="m5 12 4 4L19 6" />
                ) : (
                  <>
                    <rect x="8" y="8" width="12" height="12" rx="2" />
                    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
                  </>
                )}
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ActionContent({
  action,
  source,
  search,
}: {
  action: Action;
  source: string;
  search: string;
}) {
  return (
    <div class="action-content">
      {action.detail && (
        <SavedText text={action.detail} label="action text" search={search} />
      )}
      {["compaction", "abort", "limit", "error", "permission"].includes(
        action.kind,
      ) &&
        action.status && (
          <div class="tool-status">
            Status: <HighlightedText text={action.status} search={search} />
          </div>
        )}
      {action.kind === "tool" && (
        <>
          {action.status && (
            <div class="tool-status">
              Status: <HighlightedText text={action.status} search={search} />
            </div>
          )}
          <div class="tool-section">
            <b>Input</b>
            <SavedText
              text={action.input || `No input saved by ${source}`}
              label="tool input"
              search={search}
              copyable={Boolean(action.input)}
            />
          </div>
          <div class="tool-section">
            <b>Result / output</b>
            <SavedText
              text={action.output || `No result saved by ${source}`}
              label="tool result"
              search={search}
              copyable={Boolean(action.output)}
            />
          </div>
        </>
      )}
    </div>
  );
}

export function SessionView({
  detail,
  preview,
  options,
  error,
  onClose,
}: {
  detail: Detail | null;
  preview?: Session;
  options: Options;
  error: string;
  onClose: () => void;
}) {
  const [expanded, setExpanded] = useState<string[]>([]);
  const [searchText, setSearchText] = useState("");
  const search = searchText.trim().toLowerCase();
  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousPageOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousPageOverflow;
    };
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);
  useEffect(() => {
    if (detail) {
      setExpanded(
        detail.actions
          .filter((action) => !action.parentId)
          .slice(0, 4)
          .map((action) => action.id),
      );
    }
  }, [detail?.session.id]);
  useEffect(() => setSearchText(""), [detail?.session.id]);
  const byParent = (id: string) =>
    detail?.actions.filter((action) => action.parentId === id) || [];
  const matches = (action: Action) =>
    !search ||
    [
      action.label,
      action.kind,
      action.detail,
      action.input,
      action.output,
      action.status,
      date(action.created),
    ].some((value) => value?.toLowerCase().includes(search));
  const visibleActions =
    detail?.actions.filter(
      (action) =>
        !action.parentId &&
        (matches(action) || byParent(action.id).some(matches)),
    ) || [];
  const matchCount = detail?.actions.filter(matches).length || 0;
  useEffect(() => {
    if (search && detail) {
      setExpanded(
        detail.actions
          .filter(
            (action) => !action.parentId && byParent(action.id).some(matches),
          )
          .map((action) => action.id),
      );
    }
  }, [search, detail]);
  const session = detail?.session || preview;
  const project =
    options.projects.find((item) => item.id === session?.projectId)?.name ||
    "Unknown project";
  const source =
    options.sources.find((item) => item.id === session?.sourceId)?.name ||
    "Unknown source";
  return (
    <section class="session-view" aria-label="Session details">
      <header class="session-caption">
        <button
          class="session-back"
          type="button"
          onClick={onClose}
          aria-label="Back to previous view"
        >
          <BackIcon />
        </button>
        <div class="session-caption-text">
          <strong title={session?.title || ""}>
            {session
              ? session.title || "Untitled session"
              : error
                ? "Session unavailable"
                : "Loading session…"}
          </strong>
          {session && (
            <small>
              <span class="session-start">Started {date(session.created)}</span>
              <span aria-hidden="true">·</span>
              <span class="session-project" title={project}>
                {project}
              </span>
            </small>
          )}
        </div>
      </header>
      <div class="session-view-scroll">
        <div class="session-view-content">
          {error && (
            <div class="detail-error">
              Could not load session details: {error}
            </div>
          )}
          {!detail && !error && (
            <div class="session-loading">Loading session details…</div>
          )}
          {detail && (
            <>
              <div class="session-summary">
                <dl class="session-summary-column">
                  <dt>Source</dt>
                  <dd>
                    {source === "codex"
                      ? "Codex"
                      : source === "copilot"
                        ? "GitHub Copilot"
                        : source === "opencode"
                          ? "OpenCode"
                          : source === "kilo"
                            ? "Kilo Code"
                            : source}
                  </dd>
                  <dt>Started</dt>
                  <dd>{date(detail.session.created)}</dd>
                </dl>
                <dl class="session-summary-column">
                  <dt>Total tokens</dt>
                  <dd>{num(total(detail.session.tokens))}</dd>
                  <dt>Uncached input</dt>
                  <dd>{num(detail.session.tokens.input)}</dd>
                  <dt>Output</dt>
                  <dd>{num(detail.session.tokens.output)}</dd>
                </dl>
                <dl class="session-summary-column">
                  <dt>Reasoning</dt>
                  <dd>{num(detail.session.tokens.reasoning)}</dd>
                  <dt>Cache read</dt>
                  <dd>{num(detail.session.tokens.cacheRead)}</dd>
                  <dt>Cache write</dt>
                  <dd>{num(detail.session.tokens.cacheWrite)}</dd>
                </dl>
              </div>
              <div class="session-actions">
                <h3>Model usage</h3>
                {source === "copilot" && (
                  <p>
                    Copilot IDEA records output tokens only; other token counts
                    are unavailable.
                  </p>
                )}
                <div class="usage-list">
                  {detail.usage.map((row) => (
                    <div key={row.model}>
                      <span>{row.model}</span>
                      <span class="usage-tokens">
                        <b>{num(total(row.tokens))}</b>
                        <small>
                          {num(row.tokens.cacheRead)} cached read ·{" "}
                          {num(row.tokens.cacheWrite)} cache write
                        </small>
                      </span>
                    </div>
                  ))}
                </div>
                <div class="action-heading">
                  <h3>
                    Action tree <small>{detail.actions.length} actions</small>
                  </h3>
                  <label class="action-search">
                    <span class="sr-only">Search session actions</span>
                    <input
                      type="search"
                      placeholder="Search actions, prompts, tools…"
                      value={searchText}
                      onInput={(event) =>
                        setSearchText(event.currentTarget.value)
                      }
                    />
                  </label>
                </div>
                {search && (
                  <p class="action-search-count" role="status">
                    {matchCount} of {detail.actions.length} actions match
                  </p>
                )}
                {search && matchCount === 0 && (
                  <p class="action-search-empty">No matching actions.</p>
                )}
                {visibleActions.map((action) => {
                  const children = byParent(action.id).filter(matches);
                  const open = expanded.includes(action.id);
                  return (
                    <div key={action.id} class={`action ${action.kind}`}>
                      <button
                        class="action-parent"
                        onClick={() =>
                          setExpanded((value) =>
                            open
                              ? value.filter((id) => id !== action.id)
                              : [...value, action.id],
                          )
                        }
                      >
                        <span class={"action-dot " + action.kind} />
                        <span>
                          <b>
                            <HighlightedText
                              text={action.label}
                              search={search}
                            />
                          </b>
                          <small>
                            <HighlightedText
                              text={action.kind}
                              search={search}
                            />{" "}
                            ·{" "}
                            <HighlightedText
                              text={date(action.created)}
                              search={search}
                            />
                          </small>
                        </span>
                        <span>
                          {children.length
                            ? `${children.length} actions ${open ? "⌄" : "›"}`
                            : ""}
                        </span>
                      </button>
                      <ActionContent
                        action={action}
                        source={source}
                        search={search}
                      />
                      {open &&
                        children.map((child) => (
                          <details
                            key={child.id}
                            class="child"
                            open={Boolean(search)}
                          >
                            <summary>
                              <span class={"action-dot " + child.kind} />
                              <b>
                                <HighlightedText
                                  text={child.label || child.kind}
                                  search={search}
                                />
                              </b>
                              <small>
                                <HighlightedText
                                  text={child.kind}
                                  search={search}
                                />
                              </small>
                            </summary>
                            <ActionContent
                              action={child}
                              source={source}
                              search={search}
                            />
                          </details>
                        ))}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
