import { useEffect, useRef, useState } from "preact/hooks";
import type { Options } from "./types";

type FilterProps = {
  options: Options;
  projects: string[];
  models: string[];
  sources: string[];
  name: string;
  regex: boolean;
  caseSensitive: boolean;
  from: string;
  to: string;
  onProjects: (value: string[]) => void;
  onModels: (value: string[]) => void;
  onSources: (value: string[]) => void;
  onName: (value: string) => void;
  onRegex: (value: boolean) => void;
  onCaseSensitive: (value: boolean) => void;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
};

type Choice = { id: string; name: string };

function MultiSelectFilter({
  label,
  choices,
  selected,
  onChange,
}: {
  label: string;
  choices: Choice[];
  selected: string[];
  onChange: (value: string[]) => void;
}) {
  const picker = useRef<HTMLDetailsElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const showSearch = choices.length > 5;
  const matches = choices.filter((choice) =>
    choice.name
      .toLocaleLowerCase()
      .includes(showSearch ? query.trim().toLocaleLowerCase() : ""),
  );
  const selectedNames = choices
    .filter((choice) => selected.includes(choice.id))
    .map((choice) => choice.name);
  const summary =
    selected.length === 0
      ? `All ${label.toLowerCase()}`
      : selectedNames.length === 1
        ? selectedNames[0]
        : `${selected.length} ${label.toLowerCase()} selected`;

  useEffect(() => {
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (
        picker.current?.open &&
        event.target instanceof Node &&
        !picker.current.contains(event.target)
      ) {
        picker.current.open = false;
        setQuery("");
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && picker.current?.open) {
        picker.current.open = false;
        setQuery("");
        picker.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  return (
    <div class="multi-select-filter">
      <span>{label}</span>
      <details
        class="filter-picker"
        ref={picker}
        onToggle={(event) => {
          if (event.currentTarget.open) {
            document
              .querySelectorAll<HTMLDetailsElement>(".filter-picker[open]")
              .forEach((other) => {
                if (other !== event.currentTarget) other.open = false;
              });
            if (showSearch) search.current?.focus();
          } else setQuery("");
        }}
      >
        <summary title={selectedNames.join(", ")}>
          <span>{summary}</span>
        </summary>
        <div class="filter-options">
          {showSearch && (
            <input
              ref={search}
              class="filter-search"
              type="search"
              value={query}
              placeholder={`Search ${label.toLowerCase()}`}
              aria-label={`Search ${label.toLowerCase()}`}
              onInput={(event) => setQuery(event.currentTarget.value)}
            />
          )}
          <div class="filter-options-list">
            {choices.length === 0 ? (
              <em>No {label.toLowerCase()} yet</em>
            ) : (
              <>
                <button type="button" onClick={() => onChange([])}>
                  All {label.toLowerCase()}
                </button>
                {matches.length ? (
                  matches.map((choice) => (
                    <label key={choice.id} title={choice.name}>
                      <input
                        type="checkbox"
                        checked={selected.includes(choice.id)}
                        onChange={() =>
                          onChange(
                            selected.includes(choice.id)
                              ? selected.filter((value) => value !== choice.id)
                              : [...selected, choice.id],
                          )
                        }
                      />
                      <span>{choice.name}</span>
                    </label>
                  ))
                ) : (
                  <em>No matching {label.toLowerCase()}</em>
                )}
              </>
            )}
          </div>
        </div>
      </details>
    </div>
  );
}

function DateTimeFilter({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [display, setDisplay] = useState(value.replace("T", " "));
  const id = `date-time-${label.toLowerCase()}`;

  useEffect(() => setDisplay(value.replace("T", " ")), [value]);

  const update = (text: string) => {
    setDisplay(text);
    if (text === "") {
      onChange("");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(text)) return;
    const date = new Date(text.replace(" ", "T"));
    if (
      !Number.isNaN(date.getTime()) &&
      date.getFullYear() === Number(text.slice(0, 4)) &&
      date.getMonth() + 1 === Number(text.slice(5, 7)) &&
      date.getDate() === Number(text.slice(8, 10)) &&
      date.getHours() === Number(text.slice(11, 13)) &&
      date.getMinutes() === Number(text.slice(14, 16))
    ) {
      onChange(text.replace(" ", "T"));
    }
  };

  return (
    <div class="date-time-filter">
      <label htmlFor={id}>{label}</label>
      <span class="date-time-control">
        <input
          id={id}
          class="date-time-text"
          type="text"
          inputMode="numeric"
          value={display}
          placeholder="yyyy-mm-dd HH:MM"
          aria-label={
            label === "FROM" ? "From date and time" : "To date and time"
          }
          onInput={(event) => update(event.currentTarget.value)}
          onBlur={() => setDisplay(value.replace("T", " "))}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              event.currentTarget.blur();
            }
          }}
        />
        <span class="date-time-picker">
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="5" width="18" height="16" rx="2" />
            <path d="M7 3v4M17 3v4M3 10h18" />
          </svg>
          <input
            type="datetime-local"
            value={value}
            aria-label={`Choose ${label.toLowerCase()} date and time`}
            onInput={(event) => onChange(event.currentTarget.value)}
          />
        </span>
        {(value || display) && (
          <button
            type="button"
            class="date-time-clear"
            aria-label={`Clear ${label.toLowerCase()} date and time`}
            title="Clear date and time"
            onClick={() => {
              setDisplay("");
              onChange("");
            }}
          >
            ×
          </button>
        )}
      </span>
    </div>
  );
}

export function Filters({
  options,
  projects,
  models,
  sources,
  name,
  regex,
  caseSensitive,
  from,
  to,
  onProjects,
  onModels,
  onSources,
  onName,
  onRegex,
  onCaseSensitive,
  onFrom,
  onTo,
}: FilterProps) {
  return (
    <section class="filter-panel">
      <div class="filter-title">
        <b>Filters</b>
        <button
          onClick={() => {
            onProjects([]);
            onModels([]);
            onSources([]);
            onName("");
            onRegex(false);
            onCaseSensitive(false);
            onFrom("");
            onTo("");
          }}
        >
          Clear all
        </button>
      </div>
      <div class="filters">
        <div class="session-name-filter">
          <label htmlFor="session-name-search">SESSION NAME</label>
          <div class="session-search-control">
            <input
              id="session-name-search"
              type="search"
              value={name}
              maxLength={200}
              placeholder="Search session names"
              onInput={(event) => onName(event.currentTarget.value)}
            />
            <button
              type="button"
              class="search-mode"
              aria-label="Regular expression"
              title="Regular expression"
              aria-pressed={regex}
              onClick={() => onRegex(!regex)}
            >
              <span aria-hidden="true">.*</span>
            </button>
            <button
              type="button"
              class="search-mode"
              aria-label="Case sensitive"
              title="Case sensitive"
              aria-pressed={caseSensitive}
              onClick={() => onCaseSensitive(!caseSensitive)}
            >
              <span aria-hidden="true">Aa</span>
            </button>
          </div>
        </div>
        <MultiSelectFilter
          label="SOURCES"
          choices={options.sources.map((source) => ({
            id: String(source.id),
            name:
              source.name === "opencode"
                ? "OpenCode"
                : source.name === "copilot"
                  ? "GitHub Copilot"
                  : source.name === "kilo"
                    ? "Kilo Code"
                    : "Codex",
          }))}
          selected={sources}
          onChange={onSources}
        />
        <DateTimeFilter label="FROM" value={from} onChange={onFrom} />
        <DateTimeFilter label="TO" value={to} onChange={onTo} />
        <MultiSelectFilter
          label="PROJECTS"
          choices={options.projects}
          selected={projects}
          onChange={onProjects}
        />
        <MultiSelectFilter
          label="MODELS"
          choices={options.models.map((model) => ({ id: model, name: model }))}
          selected={models}
          onChange={onModels}
        />
      </div>
    </section>
  );
}
