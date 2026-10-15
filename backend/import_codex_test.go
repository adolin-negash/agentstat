package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCodexImportAndSourceFilter(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "sessions")
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	lines := []string{
		`{"timestamp":"2026-01-01T10:00:00Z","type":"session_meta","payload":{"id":"abc","cwd":"/work/example"}}`,
		`{"timestamp":"2026-01-01T10:00:01Z","type":"turn_context","payload":{"model":"model-a","summary":"auto"}}`,
		`{"timestamp":"2026-01-01T10:00:02Z","type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"Build a page"}]}}`,
		`{"timestamp":"2026-01-01T10:00:03Z","type":"response_item","payload":{"type":"function_call","name":"shell","call_id":"call-1","arguments":"{\"command\":\"pwd\"}"}}`,
		`{"timestamp":"2026-01-01T10:00:04Z","type":"response_item","payload":{"type":"function_call_output","call_id":"call-1","output":"/work/example"}}`,
		`{"timestamp":"2026-01-01T10:00:05Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":20,"reasoning_output_tokens":5}}}}`,
		`{"timestamp":"2026-01-01T10:00:05.500Z","type":"compacted","payload":{"message":"Context summary","window_number":1}}`,
		`{"timestamp":"2026-01-01T10:00:06Z","type":"turn_context","payload":{"model":"model-b","summary":"auto"}}`,
		`{"timestamp":"2026-01-01T10:00:07Z","type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":150,"cached_input_tokens":60,"output_tokens":30,"reasoning_output_tokens":8}}}}`,
		`{"timestamp":"2026-01-01T10:00:08Z","type":"event_msg","payload":{"type":"turn_aborted","reason":"interrupted"}}`,
		`{"timestamp":"2026-01-01T10:00:09Z","type":"event_msg","payload":{"type":"task_complete","error":{"message":"context_length_exceeded"}}}`,
	}
	if err := os.WriteFile(filepath.Join(source, "rollout.jsonl"), []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite3", filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer closeAndLogError(db)
	db.SetMaxOpenConns(1)
	app := &App{db: db, codexSource: source}
	if err := app.initSchema(); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := app.importData(); err != nil {
			t.Fatal(err)
		}
	}
	_, _, _, sources, err := app.repository().Options()
	if err != nil || len(sources) != 1 || sources[0]["name"] != "codex" {
		t.Fatalf("sources=%v, err=%v", sources, err)
	}
	sourceID := sources[0]["id"].(int64)
	sessions, err := app.filtered(Filters{Sources: map[int64]bool{sourceID: true}})
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 1 || sessions[0].ID != "codex:abc" || sessions[0].ProjectID != "codex:/work/example" || sessions[0].Tokens.Total() != 180 || sessions[0].Title != "Build a page" || sessions[0].Model != "model-b" {
		t.Fatalf("sessions=%+v", sessions)
	}
	only, err := app.filtered(Filters{Models: map[string]bool{"model-b": true}})
	if err != nil || len(only) != 1 || only[0].Tokens.Total() != 60 {
		t.Fatalf("model filtered=%+v err=%v", only, err)
	}
	search := httptest.NewRecorder()
	app.dashboard(search, httptest.NewRequest("GET", fmt.Sprintf("/api/dashboard?source=%d&name=PAGE&model=model-b", sourceID), nil))
	if search.Code != 200 || !strings.Contains(search.Body.String(), `"sessions":1`) || !strings.Contains(search.Body.String(), `"input":30`) {
		t.Fatalf("Codex name search: status=%d body=%q", search.Code, search.Body.String())
	}
	recorder := httptest.NewRecorder()
	app.detail(recorder, httptest.NewRequest("GET", "/api/sessions/codex:abc", nil))
	var detail struct {
		Actions []Action `json:"actions"`
	}
	if recorder.Code != 200 || json.Unmarshal(recorder.Body.Bytes(), &detail) != nil || len(detail.Actions) != 5 || detail.Actions[1].Output != "/work/example" || detail.Actions[2].Kind != "compaction" || detail.Actions[2].Detail != "Context summary" || detail.Actions[2].Created != codexTime("2026-01-01T10:00:05.500Z") || detail.Actions[3].Kind != "abort" || detail.Actions[4].Kind != "limit" {
		t.Fatalf("detail=%s", recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	app.dashboard(recorder, httptest.NewRequest("GET", "/api/dashboard?source=invalid", nil))
	if recorder.Code != 400 {
		t.Fatalf("invalid source code=%d", recorder.Code)
	}
}

func TestCodexThreadSettingsModel(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "sessions")
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	lines := `{"timestamp":"2026-01-01T10:00:00Z","type":"session_meta","payload":{"id":"settings-only","cwd":"/work/example"}}
{"timestamp":"2026-01-01T10:00:01Z","type":"event_msg","payload":{"type":"thread_settings_applied","thread_settings":{"model":"model-settings"}}}
`
	if err := os.WriteFile(filepath.Join(source, "rollout.jsonl"), []byte(lines), 0600); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite3", filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer closeAndLogError(db)
	app := &App{db: db, codexSource: source}
	if err := app.initSchema(); err != nil {
		t.Fatal(err)
	}
	if err := app.importData(); err != nil {
		t.Fatal(err)
	}
	sessions, err := app.filtered(Filters{})
	if err != nil || len(sessions) != 1 || sessions[0].Model != "model-settings" || len(sessions[0].Models) != 1 || sessions[0].Models[0] != "model-settings" {
		t.Fatalf("sessions=%+v err=%v", sessions, err)
	}
}

func TestCodexPermissionRequest(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "sessions")
	if err := os.MkdirAll(source, 0700); err != nil {
		t.Fatal(err)
	}
	lines := []string{
		`{"timestamp":"2026-01-01T10:00:00Z","type":"session_meta","payload":{"id":"permissions","cwd":"/work/example"}}`,
		`{"timestamp":"2026-01-01T10:00:01Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"one","arguments":"{\"cmd\":\"install package\",\"sandbox_permissions\":\"require_escalated\",\"justification\":\"Allow installing the package?\"}"}}`,
		`{"timestamp":"2026-01-01T10:00:02Z","type":"response_item","payload":{"type":"function_call_output","call_id":"one","output":"done"}}`,
		`{"timestamp":"2026-01-01T10:00:03Z","type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"two","arguments":"{\"cmd\":\"go test ./...\"}"}}`,
	}
	if err := os.WriteFile(filepath.Join(source, "rollout.jsonl"), []byte(strings.Join(lines, "\n")+"\n"), 0600); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite3", filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer closeAndLogError(db)
	app := &App{db: db, codexSource: source}
	if err := app.initSchema(); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := app.importData(); err != nil {
			t.Fatal(err)
		}
	}
	actions, err := app.repository().Actions("codex:permissions")
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 3 || actions[0].Kind != "permission" || actions[0].Detail != "Allow installing the package?" || actions[0].Status != "requested" || actions[1].ID != "codex:permissions:1" || actions[1].Output != "done" || actions[2].ID != "codex:permissions:2" {
		t.Fatalf("actions=%+v", actions)
	}
}
