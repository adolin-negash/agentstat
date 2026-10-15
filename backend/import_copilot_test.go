package main

import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCopilotIDEAImport(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "session-state")
	for _, name := range []string{"idea-session", "cli-session"} {
		if err := os.MkdirAll(filepath.Join(source, name), 0700); err != nil {
			t.Fatal(err)
		}
	}
	workspace := `id: idea-123
cwd: /work/example/subdir
git_root: /work/example
repository: example
client_name: copilot-intellij
name: |-
  Review this change
  Check the tests
created_at: 2026-01-01T10:00:00Z
updated_at: 2026-01-01T10:00:10Z
`
	if err := os.WriteFile(filepath.Join(source, "idea-session", "workspace.yaml"), []byte(workspace), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "cli-session", "workspace.yaml"), []byte(strings.Replace(workspace, "copilot-intellij", "copilot-cli", 1)), 0600); err != nil {
		t.Fatal(err)
	}
	events := []string{
		`{"id":"1","type":"session.start","timestamp":"2026-01-01T10:00:00Z","data":{"selectedModel":"model-a"}}`,
		`{"id":"2","type":"user.message","timestamp":"2026-01-01T10:00:01Z","data":{"content":"Review this change"}}`,
		`{"id":"3","type":"assistant.message","timestamp":"2026-01-01T10:00:02Z","data":{"model":"model-a","content":"Looks good","outputTokens":11}}`,
		`{"id":"4","type":"tool.execution_start","timestamp":"2026-01-01T10:00:03Z","data":{"toolCallId":"call-1","toolName":"read_file","arguments":{"path":"a.go"}}}`,
		`{"id":"5","type":"tool.execution_complete","timestamp":"2026-01-01T10:00:04Z","data":{"toolCallId":"call-1","success":true,"result":{"content":"package main"}}}`,
		`{"id":"6","type":"assistant.message","timestamp":"2026-01-01T10:00:05Z","data":{"model":"model-b","content":"Done","outputTokens":7}}`,
		`{"id":"7","type":"permission.requested","timestamp":"2026-01-01T10:00:06Z","data":{"requestId":"req","permissionRequest":{"intention":"Run command"}}}`,
		`{"id":"8","type":"permission.completed","timestamp":"2026-01-01T10:00:07Z","data":{"requestId":"req","result":{"kind":"approved"}}}`,
		`{"id":"9","type":"abort","timestamp":"2026-01-01T10:00:08Z","data":{"reason":"stopped"}}`,
	}
	for _, name := range []string{"idea-session", "cli-session"} {
		if err := os.WriteFile(filepath.Join(source, name, "events.jsonl"), []byte(strings.Join(events, "\n")+"\n"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	db, err := sql.Open("sqlite3", filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer closeAndLogError(db)
	db.SetMaxOpenConns(1)
	app := &App{db: db, copilotSource: source}
	if err := app.initSchema(); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := app.importData(); err != nil {
			t.Fatal(err)
		}
	}
	sessions, err := app.filtered(Filters{})
	if err != nil || len(sessions) != 1 {
		t.Fatalf("sessions=%+v err=%v", sessions, err)
	}
	s := sessions[0]
	if s.ID != "copilot:idea-123" || s.ProjectID != "copilot:/work/example" || s.Title != "Review this change\nCheck the tests" || s.Tokens.Output != 18 || s.Tokens.Input != 0 {
		t.Fatalf("session=%+v", s)
	}
	filtered, err := app.filtered(Filters{Models: map[string]bool{"model-b": true}})
	if err != nil || len(filtered) != 1 || filtered[0].Tokens.Output != 7 {
		t.Fatalf("filtered=%+v err=%v", filtered, err)
	}
	detail, err := app.service().Detail(s.ID)
	if err != nil || len(detail.Actions) != 6 || detail.Actions[2].Kind != "tool" || !strings.Contains(detail.Actions[2].Output, "package main") || detail.Actions[4].Status != "approved" || detail.Actions[5].Kind != "abort" {
		t.Fatalf("detail=%+v err=%v", detail, err)
	}
}

func TestCopilotWorkspaceNames(t *testing.T) {
	tests := []struct {
		name string
		want string
	}{
		{`name: |-` + "\n  First line\n\n  Second line\n", "First line\n\nSecond line"},
		{`name: "Plan \"A\"\nNext"` + "\n", "Plan \"A\"\nNext"},
		{`name: 'Bob''s plan'` + "\n", "Bob's plan"},
	}
	for _, test := range tests {
		path := filepath.Join(t.TempDir(), "workspace.yaml")
		if err := os.WriteFile(path, []byte(test.name), 0600); err != nil {
			t.Fatal(err)
		}
		values, err := copilotWorkspace(path)
		if err != nil {
			t.Fatal(err)
		}
		if values["name"] != test.want {
			t.Errorf("name = %q, want %q", values["name"], test.want)
		}
	}
}
