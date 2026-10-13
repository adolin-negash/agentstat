package main

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"
)

// Service applies dashboard rules to records returned by Repository.
type Service struct{ repo *Repository }

func (a *App) service() *Service                           { return &Service{repo: a.repository()} }
func (a *App) filtered(filters Filters) ([]Session, error) { return a.service().Filtered(filters) }

func (s *Service) Filtered(filters Filters) ([]Session, error) {
	sessions, err := s.repo.Sessions()
	if err != nil {
		return nil, err
	}
	usageBySession, err := s.repo.UsageBySession()
	if err != nil {
		return nil, err
	}
	result := make([]Session, 0, len(sessions))
	name := strings.ToLower(filters.Name)
	for _, session := range sessions {
		if filters.From > 0 && session.Created < filters.From || filters.To > 0 && session.Created >= filters.To || len(filters.Projects) > 0 && !filters.Projects[session.ProjectID] || len(filters.Sources) > 0 && !filters.Sources[session.SourceID] || name != "" && !strings.Contains(strings.ToLower(session.Title), name) {
			continue
		}
		session.ModelTokens = map[string]int64{}
		usage := usageBySession[session.ID]
		matched := Tokens{}
		hasMatch := false
		for _, row := range usage {
			session.Models = append(session.Models, row.Model)
			if len(filters.Models) == 0 || filters.Models[row.Model] {
				session.ModelTokens[row.Model] += row.Tokens.Total()
			}
			if filters.Models[row.Model] {
				matched.Add(row.Tokens)
				hasMatch = true
			}
		}
		sort.Strings(session.Models)
		if len(filters.Models) > 0 {
			if !hasMatch {
				continue
			}
			session.Tokens = matched
		} else {
			var attributed int64
			for _, tokens := range session.ModelTokens {
				attributed += tokens
			}
			if remainder := session.Tokens.Total() - attributed; remainder > 0 {
				session.ModelTokens["Unknown"] += remainder
			}
		}
		result = append(result, session)
	}
	return result, nil
}

type Dashboard struct {
	Sessions []Session `json:"sessions"`
	Summary  struct {
		Sessions int    `json:"sessions"`
		Tokens   Tokens `json:"tokens"`
	} `json:"summary"`
	Bars []DashboardBar `json:"bars"`
}
type DashboardBar struct {
	Date     string           `json:"date"`
	Sessions int              `json:"sessions"`
	Tokens   int64            `json:"tokens"`
	Models   map[string]int64 `json:"models"`
}

type daySummary struct {
	Count  int
	Tokens Tokens
	Models map[string]int64
}

func (s *Service) Dashboard(filters Filters) (Dashboard, error) {
	var dashboard Dashboard
	sessions, err := s.Filtered(filters)
	if err != nil {
		return dashboard, err
	}
	dashboard.Sessions = sessions
	dashboard.Summary.Sessions = len(sessions)
	days := map[string]daySummary{}
	for _, session := range sessions {
		dashboard.Summary.Tokens.Add(session.Tokens)
		day := time.UnixMilli(session.Created).In(time.Local).Format("2006-01-02")
		current := days[day]
		current.Count++
		current.Tokens.Add(session.Tokens)
		if current.Models == nil {
			current.Models = map[string]int64{}
		}
		for model, tokens := range session.ModelTokens {
			current.Models[model] += tokens
		}
		days[day] = current
	}
	keys := make([]string, 0, len(days))
	for day := range days {
		keys = append(keys, day)
	}
	sort.Strings(keys)
	dashboard.Bars = []DashboardBar{}
	for _, day := range keys {
		current := days[day]
		dashboard.Bars = append(dashboard.Bars, DashboardBar{Date: day, Sessions: current.Count, Tokens: current.Tokens.Total(), Models: current.Models})
	}
	return dashboard, nil
}

type SessionDetail struct {
	Session Session  `json:"session"`
	Actions []Action `json:"actions"`
	Usage   []Usage  `json:"usage"`
}

func (s *Service) Detail(id string) (SessionDetail, error) {
	var detail SessionDetail
	var err error
	if detail.Session, err = s.repo.Session(id); err != nil {
		return detail, err
	}
	if detail.Actions, err = s.repo.Actions(id); err != nil {
		return detail, err
	}
	if detail.Usage, err = s.repo.Usage(id); err != nil {
		return detail, err
	}
	return detail, nil
}

type importSource struct {
	name string
	path string
	run  func() error
}

type importResult struct {
	name        string
	newSessions int
	err         error
}

func (a *App) sources() []importSource {
	return []importSource{
		{name: "opencode", path: a.source, run: a.importOpenCode},
		{name: "codex", path: a.codexSource, run: a.importCodex},
		{name: "copilot", path: a.copilotSource, run: a.importCopilot},
		{name: "kilo", path: a.kiloSource, run: a.importKilo},
	}
}

func (a *App) importSources(selected map[string]bool) ([]importResult, error) {
	var results []importResult
	var problems []string
	for _, source := range a.sources() {
		if selected != nil && !selected[source.name] {
			continue
		}
		result := importResult{name: source.name}
		if source.path == "" {
			result.err = fmt.Errorf("%s source is not configured", source.name)
		} else {
			var before, after int
			before, result.err = a.repository().CountSessions(source.name)
			if result.err == nil {
				result.err = source.run()
			}
			if count, countErr := a.repository().CountSessions(source.name); countErr != nil && result.err == nil {
				result.err = countErr
			} else {
				after = count
			}
			result.newSessions = after - before
		}
		if result.err != nil {
			problems = append(problems, fmt.Sprintf("%s: %v", source.name, result.err))
		}
		results = append(results, result)
	}
	if len(results) == 0 {
		return results, errors.New("no sources selected")
	}
	if len(problems) > 0 {
		return results, errors.New(strings.Join(problems, "; "))
	}
	return results, nil
}

func (a *App) importData() error {
	selected := map[string]bool{}
	for _, source := range a.sources() {
		if source.path != "" {
			selected[source.name] = true
		}
	}
	results, err := a.importSources(selected)
	if len(results) == 0 {
		return errors.New("no sources configured")
	}
	imported := false
	for _, result := range results {
		if result.err == nil {
			imported = true
		}
	}
	if !imported {
		return err
	}
	a.lastImport = time.Now()
	if err != nil {
		a.importErr = err.Error()
	} else {
		a.importErr = ""
	}
	return nil
}
