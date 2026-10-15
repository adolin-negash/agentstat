package main

import (
	"encoding/json"
	"errors"
	"log"
	"path/filepath"
	"strings"
)

type sourceSchema struct{ session, message, part string }

func (a *App) importOpenCode() error {
	src, err := openSource(a.source)
	if err != nil {
		return err
	}
	defer closeAndLogError(src)
	tx, err := a.repository().Begin()
	if err != nil {
		return err
	}
	defer rollbackIfOpen(tx)
	imported, supported := 0, false
	for _, schema := range []sourceSchema{{"session", "message", "part"}, {"session_v2", "session_message", ""}} {
		if !(&SourceRepository{db: src}).TableExists(schema.session) {
			continue
		}
		supported = true
		rows, err := (&SourceRepository{db: src}).Sessions(schema)
		if err != nil {
			return err
		}
		for rows.Next() {
			var s Session
			var modelJSON string
			err = rows.Scan(&s.ID, &s.Title, &s.ProjectID, &s.Project, &s.Directory, &s.ParentID, &modelJSON, &s.Created, &s.Updated, &s.Tokens.Input, &s.Tokens.Output, &s.Tokens.Reasoning, &s.Tokens.CacheRead, &s.Tokens.CacheWrite)
			if err != nil {
				closeAndLogError(rows)
				return err
			}
			s.Model = modelName(modelJSON)
			if s.Project == "" {
				s.Project = filepath.Base(s.Directory)
			}
			s.Source = "opencode"
			err = a.repository().SaveSession(tx, s)
			if err == nil {
				err = a.importActions(src, tx, s, schema)
			}
			if err != nil {
				closeAndLogError(rows)
				return err
			}
			imported++
		}
		err = rows.Err()
		closeAndLogError(rows)
		if err != nil {
			return err
		}
	}
	if !supported {
		return errors.New("no supported OpenCode session tables found")
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	log.Printf("imported %d OpenCode sessions", imported)
	return nil
}

func modelName(raw string) string {
	var model struct {
		ID      string `json:"id"`
		ModelID string `json:"modelID"`
	}
	_ = json.Unmarshal([]byte(raw), &model)
	if model.ID != "" {
		return model.ID
	}
	if model.ModelID != "" {
		return model.ModelID
	}
	return "Unknown"
}

func tokenFromMap(m map[string]any) Tokens {
	get := func(v any) int64 { value, _ := v.(float64); return int64(value) }
	t := Tokens{Input: get(m["input"]), Output: get(m["output"]), Reasoning: get(m["reasoning"])}
	if cache, ok := m["cache"].(map[string]any); ok {
		t.CacheRead, t.CacheWrite = get(cache["read"]), get(cache["write"])
	}
	return t
}
func asMap(v any) map[string]any { m, _ := v.(map[string]any); return m }
func str(v any) string           { value, _ := v.(string); return value }
func actionKindLabel(kind string) string {
	if kind == "" {
		return ""
	}
	return strings.ToUpper(kind[:1]) + kind[1:]
}
func clip(value string, limit int) string {
	runes := []rune(strings.TrimSpace(value))
	if len(runes) > limit {
		return string(runes[:limit]) + "…"
	}
	return string(runes)
}
func modelNameJSON(v any) string {
	model := asMap(v)
	if id := str(model["id"]); id != "" {
		return id
	}
	if id := str(model["modelID"]); id != "" {
		return id
	}
	return "Unknown"
}
func partText(part map[string]any) (string, string) {
	kind := str(part["type"])
	switch kind {
	case "tool":
		name := str(part["name"])
		if name == "" {
			name = str(part["tool"])
		}
		state := asMap(part["state"])
		detail := str(state["title"])
		input := asMap(state["input"])
		if len(input) == 0 {
			input = asMap(part["input"])
		}
		for _, key := range []string{"filePath", "path", "command", "url", "pattern"} {
			if value := str(input[key]); value != "" {
				return "Tool · " + name + " · " + clip(value, 120), detail
			}
		}
		return "Tool · " + name, detail
	case "text", "reasoning":
		value := str(part["text"])
		return clip(value, 120), value
	default:
		return actionKindLabel(kind), ""
	}
}

// toolFields retains the data needed to inspect a tool call after the source is closed.
func toolFields(part map[string]any) (input, output, status string) {
	if str(part["type"]) != "tool" {
		return "", "", ""
	}
	state := asMap(part["state"])
	inputValue, ok := state["input"]
	if !ok {
		inputValue = part["input"]
	}
	outputValue, ok := state["output"]
	if !ok {
		outputValue = part["output"]
	}
	input = displayJSON(inputValue)
	output = displayJSON(outputValue)
	if output == "" {
		output = displayJSON(state["error"])
	}
	if output == "" {
		output = toolContent(state["content"])
	}
	status = str(state["status"])
	return
}

func toolContent(value any) string {
	items, ok := value.([]any)
	if !ok {
		return displayJSON(value)
	}
	parts := make([]string, 0, len(items))
	for _, item := range items {
		if text := str(asMap(item)["text"]); text != "" {
			parts = append(parts, text)
		} else if rendered := displayJSON(item); rendered != "" {
			parts = append(parts, rendered)
		}
	}
	return strings.Join(parts, "\n")
}

func displayJSON(value any) string {
	if value == nil {
		return ""
	}
	if text, ok := value.(string); ok {
		return text
	}
	encoded, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return ""
	}
	return string(encoded)
}
