package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type codexRecord struct {
	Timestamp string          `json:"timestamp"`
	Type      string          `json:"type"`
	Payload   json.RawMessage `json:"payload"`
}

type codexPayload struct {
	Type    string `json:"type"`
	ID      string `json:"id"`
	Cwd     string `json:"cwd"`
	Model   string `json:"model"`
	Role    string `json:"role"`
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	Summary        json.RawMessage `json:"summary"`
	Name           string          `json:"name"`
	CallID         string          `json:"call_id"`
	Arguments      json.RawMessage `json:"arguments"`
	Input          json.RawMessage `json:"input"`
	Output         json.RawMessage `json:"output"`
	Status         string          `json:"status"`
	Message        string          `json:"message"`
	Reason         string          `json:"reason"`
	Error          json.RawMessage `json:"error"`
	ThreadSettings *struct {
		Model string `json:"model"`
	} `json:"thread_settings"`
	Info *struct {
		Total *struct {
			Input      int64 `json:"input_tokens"`
			Output     int64 `json:"output_tokens"`
			Reasoning  int64 `json:"reasoning_output_tokens"`
			CacheRead  int64 `json:"cached_input_tokens"`
			CacheWrite int64 `json:"cache_write_input_tokens"`
		} `json:"total_token_usage"`
	} `json:"info"`
}

func codexTime(value string) int64 {
	t, err := time.Parse(time.RFC3339Nano, value)
	if err != nil {
		return 0
	}
	return t.UnixMilli()
}

func codexTokens(p codexPayload) (Tokens, bool) {
	if p.Info == nil || p.Info.Total == nil {
		return Tokens{}, false
	}
	u := p.Info.Total
	// Codex includes cached input in input_tokens and reasoning in output_tokens.
	t := Tokens{Input: u.Input - u.CacheRead - u.CacheWrite, Output: u.Output - u.Reasoning, Reasoning: u.Reasoning, CacheRead: u.CacheRead, CacheWrite: u.CacheWrite}
	if t.Input < 0 {
		t.Input = 0
	}
	if t.Output < 0 {
		t.Output = 0
	}
	return t, true
}

func codexDelta(current, previous Tokens) Tokens {
	if current.Total() < previous.Total() {
		return current
	}
	return Tokens{current.Input - previous.Input, current.Output - previous.Output, current.Reasoning - previous.Reasoning, current.CacheRead - previous.CacheRead, current.CacheWrite - previous.CacheWrite}
}

func codexText(content []struct {
	Type string `json:"type"`
	Text string `json:"text"`
}) string {
	var parts []string
	for _, item := range content {
		if item.Text != "" {
			parts = append(parts, item.Text)
		}
	}
	return strings.Join(parts, "\n")
}

func codexPromptTitle(value string) string {
	trimmed := strings.TrimSpace(value)
	if strings.HasPrefix(trimmed, "# AGENTS.md instructions for ") || strings.HasPrefix(trimmed, "<external_codex_apps_open_page>") || strings.HasPrefix(trimmed, "<environment_context>") {
		return ""
	}
	return clip(trimmed, 120)
}

func rawText(value json.RawMessage) string {
	if len(value) == 0 || string(value) == "null" {
		return ""
	}
	var text string
	if json.Unmarshal(value, &text) == nil {
		return text
	}
	var data any
	if json.Unmarshal(value, &data) != nil {
		return string(value)
	}
	return displayJSON(data)
}

func codexPermissionRequest(p codexPayload) (string, bool) {
	if p.Type != "function_call" && p.Type != "custom_tool_call" {
		return "", false
	}
	raw := p.Arguments
	if len(raw) == 0 {
		raw = p.Input
	}
	var input any
	if json.Unmarshal(raw, &input) != nil {
		return "", false
	}
	if encoded, ok := input.(string); ok {
		if json.Unmarshal([]byte(encoded), &input) != nil {
			return "", false
		}
	}
	request, ok := input.(map[string]any)
	if !ok || request["sandbox_permissions"] != "require_escalated" {
		return "", false
	}
	return str(request["justification"]), true
}

func (a *App) importCodex() error {
	info, err := os.Stat(a.codexSource)
	if err != nil {
		return fmt.Errorf("Codex sessions unavailable at %s: %w", a.codexSource, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("Codex sessions path is not a directory: %s", a.codexSource)
	}
	count := 0
	err = filepath.WalkDir(a.codexSource, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".jsonl") {
			return nil
		}
		if err := a.importCodexFile(path); err != nil {
			return fmt.Errorf("%s: %w", path, err)
		}
		count++
		return nil
	})
	if err != nil {
		return err
	}
	log.Printf("scanned %d Codex session files", count)
	return nil
}

func (a *App) importCodexFile(path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	reader := bufio.NewReader(file)
	var records []codexRecord
	var meta codexPayload
	for {
		line, readErr := reader.ReadBytes('\n')
		if len(line) > 0 {
			var record codexRecord
			if json.Unmarshal(line, &record) == nil {
				if record.Type == "session_meta" && meta.ID == "" {
					_ = json.Unmarshal(record.Payload, &meta)
				}
				records = append(records, record)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return readErr
		}
	}
	if meta.ID == "" {
		return nil
	}
	sid := "codex:" + meta.ID
	created := int64(0)
	if len(records) > 0 {
		created = codexTime(records[0].Timestamp)
	}
	updated := created
	model := "Unknown"
	title := ""
	usage := map[string]Tokens{}
	actions := []Action{}
	calls := map[string]int{}
	lastAssistantID := ""
	previous := Tokens{}
	regularActions := 0
	for recordIndex, record := range records {
		when := codexTime(record.Timestamp)
		if when > updated {
			updated = when
		}
		var p codexPayload
		if json.Unmarshal(record.Payload, &p) != nil {
			continue
		}
		if record.Type == "turn_context" && p.Model != "" {
			model = p.Model
			continue
		}
		if record.Type == "event_msg" && p.Type == "thread_settings_applied" && p.ThreadSettings != nil && p.ThreadSettings.Model != "" {
			model = p.ThreadSettings.Model
			continue
		}
		if record.Type == "event_msg" && p.Type == "token_count" {
			if current, ok := codexTokens(p); ok {
				delta := codexDelta(current, previous)
				if delta.Input < 0 || delta.Output < 0 || delta.Reasoning < 0 || delta.CacheRead < 0 || delta.CacheWrite < 0 {
					delta = current
				}
				total := usage[model]
				total.Add(delta)
				usage[model] = total
				previous = current
			}
			continue
		}
		if record.Type == "compacted" {
			regularActions++
			actions = append(actions, Action{
				ID: fmt.Sprintf("%s:%d", sid, regularActions), Created: when,
				Ord: len(actions) + 1, Kind: "compaction",
				Label: "Context compacted", Detail: p.Message,
			})
			lastAssistantID = ""
			continue
		}
		if record.Type == "event_msg" && p.Type == "turn_aborted" {
			actions = append(actions, Action{
				ID: fmt.Sprintf("%s:event:%d", sid, recordIndex), Created: when,
				Ord: len(actions) + 1, Kind: "abort", Label: "Session aborted",
				Detail: p.Reason, Status: p.Reason,
			})
			lastAssistantID = ""
			continue
		}
		if record.Type == "event_msg" && p.Type == "task_complete" && len(p.Error) > 0 && string(p.Error) != "null" {
			var failure struct {
				Message string `json:"message"`
			}
			_ = json.Unmarshal(p.Error, &failure)
			message := failure.Message
			if message == "" {
				message = rawText(p.Error)
			}
			kind, label := sourceErrorEvent("", message)
			actions = append(actions, Action{
				ID: fmt.Sprintf("%s:event:%d", sid, recordIndex), Created: when,
				Ord: len(actions) + 1, Kind: kind, Label: label, Detail: message,
			})
			lastAssistantID = ""
			continue
		}
		if record.Type != "response_item" {
			continue
		}
		if justification, requested := codexPermissionRequest(p); requested {
			actions = append(actions, Action{
				ID: fmt.Sprintf("%s:permission:%d", sid, recordIndex), Created: when,
				Ord: len(actions) + 1, Kind: "permission", Label: "Permission requested",
				Detail: justification, Status: "requested",
			})
		}
		action := Action{ID: fmt.Sprintf("%s:%d", sid, regularActions+1), Created: when, Ord: len(actions) + 1}
		switch p.Type {
		case "message":
			if p.Role != "user" && p.Role != "assistant" {
				continue
			}
			action.Kind = p.Role
			action.Detail = codexText(p.Content)
			if p.Role == "user" {
				lastAssistantID = ""
				action.Label = clip(action.Detail, 120)
				if title == "" {
					title = codexPromptTitle(action.Detail)
				}
			} else {
				action.Label = "Assistant · " + model
				lastAssistantID = action.ID
			}
		case "reasoning":
			var parts []struct {
				Text string `json:"text"`
			}
			if json.Unmarshal(p.Summary, &parts) != nil || len(parts) == 0 {
				continue
			}
			var text []string
			for _, part := range parts {
				text = append(text, part.Text)
			}
			action.Kind = "reasoning"
			action.Detail = strings.Join(text, "\n")
			action.Label = clip(action.Detail, 120)
		case "function_call", "custom_tool_call":
			action.Kind = "tool"
			action.ParentID = lastAssistantID
			action.Label = "Tool · " + p.Name
			action.Input = rawText(p.Arguments)
			if action.Input == "" {
				action.Input = rawText(p.Input)
			}
			action.Status = p.Status
			if p.CallID != "" {
				calls[p.CallID] = len(actions)
			}
		case "function_call_output", "custom_tool_call_output":
			if index, ok := calls[p.CallID]; ok {
				actions[index].Output = rawText(p.Output)
				if actions[index].Status == "" {
					actions[index].Status = "completed"
				}
				continue
			}
			action.Kind = "tool"
			action.Label = "Tool result"
			action.Output = rawText(p.Output)
		default:
			continue
		}
		if action.Label == "" {
			action.Label = strings.Title(action.Kind)
		}
		actions = append(actions, action)
		regularActions++
	}
	if title == "" {
		title = "Untitled Codex session"
	}
	if created == 0 {
		created = updated
	}
	if model == "Unknown" {
		for key := range usage {
			model = key
			break
		}
	}
	total := Tokens{}
	for _, tokens := range usage {
		total.Add(tokens)
	}
	if len(usage) == 0 {
		usage[model] = Tokens{}
	}
	project := filepath.Base(meta.Cwd)
	if project == "." || project == "/" || project == "" {
		project = "Unknown project"
	}
	tx, err := a.repository().Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	err = a.repository().SaveSession(tx, Session{ID: sid, Title: title, ProjectID: "codex:" + meta.Cwd, Project: project, Directory: meta.Cwd, Model: model, Created: created, Updated: updated, Tokens: total, Source: "codex"})
	if err != nil {
		return err
	}
	for _, action := range actions {
		err = a.repository().SaveAction(tx, sid, action)
		if err != nil {
			return err
		}
	}
	for name, tokens := range usage {
		err = a.repository().SaveUsage(tx, sid, Usage{Model: name, Tokens: tokens})
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}
