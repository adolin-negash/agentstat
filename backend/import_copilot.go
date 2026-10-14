package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// Copilot's IDEA agent uses the Copilot CLI session journal. Only journals
// explicitly marked as belonging to the IntelliJ plugin are imported here.
type copilotEvent struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	Timestamp string         `json:"timestamp"`
	Data      map[string]any `json:"data"`
}

func copilotWorkspace(path string) (map[string]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	values := map[string]string{}
	scanner := bufio.NewScanner(file)
	blockKey := ""
	blockStyle := ""
	for scanner.Scan() {
		line := scanner.Text()
		if blockKey != "" && (strings.HasPrefix(line, "  ") || line == "") {
			values[blockKey] += strings.TrimPrefix(line, "  ") + "\n"
			continue
		}
		if blockKey != "" && strings.HasSuffix(blockStyle, "-") {
			values[blockKey] = strings.TrimRight(values[blockKey], "\n")
		}
		blockKey = ""
		key, value, ok := strings.Cut(line, ":")
		if !ok || strings.HasPrefix(key, " ") {
			continue
		}
		value = strings.TrimSpace(value)
		if value == "|" || value == "|-" || value == "|+" || value == ">" || value == ">-" || value == ">+" {
			blockKey = key
			blockStyle = value
			continue
		}
		if strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"") {
			if unquoted, err := strconv.Unquote(value); err == nil {
				value = unquoted
			}
		} else if strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'") {
			value = strings.ReplaceAll(value[1:len(value)-1], "''", "'")
		}
		values[key] = value
	}
	if blockKey != "" && strings.HasSuffix(blockStyle, "-") {
		values[blockKey] = strings.TrimRight(values[blockKey], "\n")
	}
	return values, scanner.Err()
}

func copilotTime(value string) int64 {
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.UnixMilli()
	}
	return 0
}

func copilotString(data map[string]any, key string) string { return str(data[key]) }

func (a *App) importCopilot() error {
	info, err := os.Stat(a.copilotSource)
	if err != nil {
		return fmt.Errorf("GitHub Copilot IDEA sessions unavailable at %s: %w", a.copilotSource, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("GitHub Copilot IDEA sessions path is not a directory: %s", a.copilotSource)
	}
	entries, err := os.ReadDir(a.copilotSource)
	if err != nil {
		return err
	}
	count := 0
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		dir := filepath.Join(a.copilotSource, entry.Name())
		workspace, err := copilotWorkspace(filepath.Join(dir, "workspace.yaml"))
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			return fmt.Errorf("%s: %w", dir, err)
		}
		if workspace["client_name"] != "copilot-intellij" {
			continue
		}
		if err := a.importCopilotFile(dir, workspace); err != nil {
			return fmt.Errorf("%s: %w", dir, err)
		}
		count++
	}
	log.Printf("scanned %d GitHub Copilot IDEA sessions", count)
	return nil
}

func (a *App) importCopilotFile(dir string, workspace map[string]string) error {
	file, err := os.Open(filepath.Join(dir, "events.jsonl"))
	if err != nil {
		return err
	}
	defer file.Close()
	id := workspace["id"]
	if id == "" {
		id = filepath.Base(dir)
	}
	sid := "copilot:" + id
	projectPath := workspace["git_root"]
	if projectPath == "" {
		projectPath = workspace["cwd"]
	}
	if projectPath == "" {
		projectPath = "Unknown project"
	}
	projectName := workspace["repository"]
	if projectName == "" {
		projectName = filepath.Base(projectPath)
	}
	created := copilotTime(workspace["created_at"])
	updated := copilotTime(workspace["updated_at"])
	title := strings.TrimSpace(workspace["name"])
	if title == "" {
		title = "Untitled Copilot session"
	}
	model := "Unknown"
	usage := map[string]Tokens{}
	actions := []Action{}
	toolIndex := map[string]int{}
	permissionIndex := map[string]int{}
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 32*1024*1024)
	for scanner.Scan() {
		var event copilotEvent
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			return fmt.Errorf("invalid event JSON: %w", err)
		}
		when := copilotTime(event.Timestamp)
		if created == 0 || when > 0 && when < created {
			created = when
		}
		if when > updated {
			updated = when
		}
		if event.Data == nil {
			event.Data = map[string]any{}
		}
		if selected := copilotString(event.Data, "selectedModel"); event.Type == "session.start" && selected != "" {
			model = selected
		}
		if selected := copilotString(event.Data, "model"); selected != "" {
			model = selected
		}
		baseID := sid + ":" + event.ID
		if event.ID == "" {
			baseID = fmt.Sprintf("%s:%d", sid, len(actions)+1)
		}
		add := func(suffix, kind, label, detail string) {
			actions = append(actions, Action{ID: baseID + suffix, Kind: kind, Label: label, Detail: detail, Created: when, Ord: len(actions) + 1})
		}
		switch event.Type {
		case "user.message":
			content := copilotString(event.Data, "content")
			if content == "" {
				content = copilotString(event.Data, "transformedContent")
			}
			if content != "" {
				add("", "user", clip(content, 120), content)
				if title == "Untitled Copilot session" {
					title = clip(content, 120)
				}
			}
		case "assistant.message":
			if tokens, ok := event.Data["outputTokens"].(float64); ok && tokens > 0 {
				row := usage[model]
				row.Output += int64(tokens)
				usage[model] = row
			}
			if reasoning := copilotString(event.Data, "reasoningText"); reasoning != "" {
				add(":reasoning", "reasoning", clip(reasoning, 120), reasoning)
			}
			if content := copilotString(event.Data, "content"); content != "" {
				add("", "assistant", "Assistant · "+model, content)
			}
		case "tool.execution_start":
			name := copilotString(event.Data, "toolName")
			add("", "tool", "Tool · "+name, "")
			actions[len(actions)-1].Input = displayJSON(event.Data["arguments"])
			if callID := copilotString(event.Data, "toolCallId"); callID != "" {
				toolIndex[callID] = len(actions) - 1
			}
		case "tool.execution_complete":
			output := displayJSON(event.Data["result"])
			if failure := displayJSON(event.Data["error"]); failure != "" {
				output = strings.TrimSpace(output + "\n" + failure)
			}
			if index, ok := toolIndex[copilotString(event.Data, "toolCallId")]; ok {
				actions[index].Output = output
				if event.Data["success"] == false {
					actions[index].Status = "failed"
				} else {
					actions[index].Status = "completed"
				}
			} else {
				add("", "tool", "Tool result", "")
				actions[len(actions)-1].Output = output
			}
		case "permission.requested":
			request := asMap(event.Data["permissionRequest"])
			if len(request) == 0 {
				request = asMap(event.Data["promptRequest"])
			}
			add("", "permission", "Permission requested", copilotString(request, "intention"))
			actions[len(actions)-1].Input = displayJSON(request)
			actions[len(actions)-1].Status = "requested"
			if requestID := copilotString(event.Data, "requestId"); requestID != "" {
				permissionIndex[requestID] = len(actions) - 1
			}
		case "permission.completed":
			if index, ok := permissionIndex[copilotString(event.Data, "requestId")]; ok {
				actions[index].Status = copilotString(asMap(event.Data["result"]), "kind")
			}
		case "abort":
			add("", "abort", "Session aborted", copilotString(event.Data, "reason"))
		}
	}
	if err := scanner.Err(); err != nil {
		return err
	}
	if created == 0 {
		created = updated
	}
	if len(usage) == 0 {
		usage[model] = Tokens{}
	}
	total := Tokens{}
	for _, tokens := range usage {
		total.Add(tokens)
	}
	tx, err := a.repository().Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if err := a.repository().SaveSession(tx, Session{ID: sid, Source: "copilot", Title: title, ProjectID: "copilot:" + projectPath, Project: projectName, Directory: workspace["cwd"], Model: model, Created: created, Updated: updated, Tokens: total}); err != nil {
		return err
	}
	for _, action := range actions {
		if err := a.repository().SaveAction(tx, sid, action); err != nil {
			return err
		}
	}
	for name, tokens := range usage {
		if err := a.repository().SaveUsage(tx, sid, Usage{Model: name, Tokens: tokens}); err != nil {
			return err
		}
	}
	return tx.Commit()
}
