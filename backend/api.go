package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf8"
)

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func (a *App) status(w http.ResponseWriter, _ *http.Request) {
	count, err := a.repository().CountSessions("")
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"version": version, "serverAddress": a.serverAddress, "databasePath": a.databasePath, "source": a.source, "codexSource": a.codexSource, "copilotSource": a.copilotSource, "kiloSource": a.kiloSource, "lastImport": a.lastImport, "importedSessions": a.importedSessions, "importError": a.importErr, "sessions": count})
}
func (a *App) refresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST required", http.StatusMethodNotAllowed)
		return
	}
	if err := a.importData(); err != nil {
		a.importErr = err.Error()
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	a.status(w, r)
}
func (a *App) options(w http.ResponseWriter, _ *http.Request) {
	projects, models, folders, sources, err := a.repository().Options()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"projects": projects, "models": models, "folders": folders, "sources": sources})
}
func parseFilters(r *http.Request) (Filters, error) {
	query := r.URL.Query()
	filters := Filters{Projects: map[string]bool{}, Models: map[string]bool{}, Sources: map[int64]bool{}}
	filters.Name = strings.TrimSpace(query.Get("name"))
	if !utf8.ValidString(filters.Name) || utf8.RuneCountInString(filters.Name) > 200 {
		return filters, errors.New("invalid name")
	}
	for _, flag := range []struct {
		name  string
		value *bool
	}{{"regex", &filters.Regex}, {"case_sensitive", &filters.CaseSensitive}} {
		if values, ok := query[flag.name]; ok {
			if len(values) != 1 || values[0] != "1" {
				return filters, fmt.Errorf("invalid %s", flag.name)
			}
			*flag.value = true
		}
	}
	if filters.Regex && filters.Name != "" {
		pattern := filters.Name
		if !filters.CaseSensitive {
			pattern = "(?i)" + pattern
		}
		if _, err := regexp.Compile(pattern); err != nil {
			return filters, errors.New("invalid regular expression")
		}
	}
	for _, source := range query["source"] {
		id, err := strconv.ParseInt(source, 10, 64)
		if err != nil || id <= 0 {
			return filters, fmt.Errorf("invalid source")
		}
		filters.Sources[id] = true
	}
	for _, project := range query["project"] {
		if project != "" {
			filters.Projects[project] = true
		}
	}
	for _, model := range query["model"] {
		if model != "" {
			filters.Models[model] = true
		}
	}
	for _, part := range []struct {
		name  string
		value *int64
	}{{"from", &filters.From}, {"to", &filters.To}} {
		if text := query.Get(part.name); text != "" {
			value, err := strconv.ParseInt(text, 10, 64)
			if err != nil {
				return filters, fmt.Errorf("invalid %s", part.name)
			}
			*part.value = value
		}
	}
	if filters.To > 0 && filters.From > filters.To {
		return filters, errors.New("from must precede to")
	}
	return filters, nil
}
func (a *App) dashboard(w http.ResponseWriter, r *http.Request) {
	filters, err := parseFilters(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	result, err := a.service().Dashboard(filters)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
func (a *App) detail(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/sessions/")
	if id == "" || strings.Contains(id, "/") {
		http.NotFound(w, r)
		return
	}
	result, err := a.service().Detail(id)
	if err == sql.ErrNoRows {
		http.NotFound(w, r)
		return
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, result)
}
