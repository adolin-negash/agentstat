package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestDashboardMultipleProjects(t *testing.T) {
	db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	a := &App{db: db}
	if err := a.initSchema(); err != nil {
		t.Fatal(err)
	}
	for _, project := range []struct {
		id, title string
		input     int
	}{{"p1", "One", 10}, {"p2", "Two", 20}, {"p3", "Three", 30}} {
		tx, err := a.repository().Begin()
		if err != nil {
			t.Fatal(err)
		}
		if err := a.repository().SaveSession(tx, Session{ID: project.id, Title: project.title, ProjectID: project.id, Project: project.title, Directory: "", Model: "", Created: 1000, Updated: 1000, Tokens: Tokens{Input: int64(project.input)}, Source: "opencode"}); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	for _, check := range []struct {
		query  string
		count  int
		tokens int64
	}{
		{"", 3, 60},
		{"?project=p1", 1, 10},
		{"?project=p1&project=p3", 2, 40},
		{"?project=p1&project=p1", 1, 10},
		{"?name=ON", 1, 10},
		{"?name=o", 2, 30},
		{"?name=o&project=p2", 1, 20},
	} {
		recorder := httptest.NewRecorder()
		a.dashboard(recorder, httptest.NewRequest("GET", "/api/dashboard"+check.query, nil))
		if recorder.Code != 200 {
			t.Fatalf("query=%q status=%d body=%q", check.query, recorder.Code, recorder.Body.String())
		}
		var result struct {
			Sessions []Session `json:"sessions"`
			Summary  struct {
				Sessions int    `json:"sessions"`
				Tokens   Tokens `json:"tokens"`
			} `json:"summary"`
			Bars []struct {
				Sessions int   `json:"sessions"`
				Tokens   int64 `json:"tokens"`
			} `json:"bars"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Sessions) != check.count || result.Summary.Sessions != check.count || result.Summary.Tokens.Total() != check.tokens || len(result.Bars) != 1 || result.Bars[0].Sessions != check.count || result.Bars[0].Tokens != check.tokens {
			t.Fatalf("query=%q result=%+v", check.query, result)
		}
		if check.query == "" {
			var payload struct {
				Sessions []map[string]any `json:"sessions"`
			}
			if err := json.Unmarshal(recorder.Body.Bytes(), &payload); err != nil {
				t.Fatal(err)
			}
			for _, session := range payload.Sessions {
				if session["projectId"] == nil || session["folderId"] == nil || session["sourceId"] == nil || session["project"] != nil || session["directory"] != nil || session["source"] != nil {
					t.Fatalf("session lookup fields=%v", session)
				}
			}
		}
	}
	recorder := httptest.NewRecorder()
	a.dashboard(recorder, httptest.NewRequest("GET", "/api/dashboard?name=missing", nil))
	if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), `"sessions":[]`) || !strings.Contains(recorder.Body.String(), `"bars":[]`) {
		t.Fatalf("no name matches: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	recorder = httptest.NewRecorder()
	a.dashboard(recorder, httptest.NewRequest("GET", "/api/dashboard?name="+strings.Repeat("x", 201), nil))
	if recorder.Code != 400 || !strings.Contains(recorder.Body.String(), "invalid name") {
		t.Fatalf("long name: status=%d body=%q", recorder.Code, recorder.Body.String())
	}
}

func TestParseFiltersRejectsInvalidValues(t *testing.T) {
	for _, check := range []struct {
		name, query, message string
	}{
		{"non-numeric source", "?source=codex", "invalid source"},
		{"zero source", "?source=0", "invalid source"},
		{"negative source", "?source=-1", "invalid source"},
		{"invalid end", "?to=tomorrow", "invalid to"},
		{"reversed range", "?from=2000&to=1000", "from must precede to"},
	} {
		t.Run(check.name, func(t *testing.T) {
			_, err := parseFilters(httptest.NewRequest("GET", "/api/dashboard"+check.query, nil))
			if err == nil || err.Error() != check.message {
				t.Fatalf("query=%q error=%v, want %q", check.query, err, check.message)
			}
		})
	}
	filters, err := parseFilters(httptest.NewRequest("GET", "/api/dashboard?source=1&source=2&project=p1&project=p2&model=a&model=b&name=%20Find%20&from=1000&to=2000", nil))
	if err != nil {
		t.Fatal(err)
	}
	if len(filters.Sources) != 2 || !filters.Sources[1] || !filters.Sources[2] || len(filters.Projects) != 2 || !filters.Projects["p1"] || !filters.Projects["p2"] || len(filters.Models) != 2 || !filters.Models["a"] || !filters.Models["b"] || filters.Name != "Find" || filters.From != 1000 || filters.To != 2000 {
		t.Fatalf("parsed filters = %+v", filters)
	}
}

func TestImportAndModelFilter(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.db")
	src, err := sql.Open("sqlite3", source)
	if err != nil {
		t.Fatal(err)
	}
	schema := `CREATE TABLE project(id TEXT PRIMARY KEY,name TEXT);CREATE TABLE session_v2(id TEXT PRIMARY KEY,title TEXT,project_id TEXT,directory TEXT,parent_id TEXT,model TEXT,time_created INTEGER,time_updated INTEGER,tokens_input INTEGER,tokens_output INTEGER,tokens_reasoning INTEGER,tokens_cache_read INTEGER,tokens_cache_write INTEGER);CREATE TABLE session_message(id TEXT PRIMARY KEY,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,data TEXT);`
	if _, err = src.Exec(schema); err != nil {
		t.Fatal(err)
	}
	if _, err = src.Exec(`INSERT INTO project VALUES('p','Example');INSERT INTO session_v2 VALUES('s','Test','p','/example',NULL,'{"id":"fallback"}',1000,2000,18,12,0,0,0);INSERT INTO session_message VALUES('m1','s','user',1,1000,'{"text":"Build a page"}');INSERT INTO session_message VALUES('m2','s','assistant',2,1100,'{"model":{"id":"model-a"},"tokens":{"input":10,"output":5,"reasoning":0,"cache":{"read":0,"write":0}},"content":[{"type":"tool","name":"read","state":{"status":"completed","input":{"filePath":"/example/main.go"},"output":"full read result","title":"Read file"}}]}');INSERT INTO session_message VALUES('m3','s','assistant',3,1200,'{"model":{"id":"model-b"},"tokens":{"input":8,"output":7,"reasoning":0,"cache":{"read":0,"write":0}},"content":[{"type":"text","text":"Done"}]}');`); err != nil {
		t.Fatal(err)
	}
	longText := strings.Repeat("A long response line.\n", 200) + "Final line"
	message, err := json.Marshal(map[string]any{
		"model":   map[string]any{"id": "model-b"},
		"tokens":  map[string]any{"input": 8, "output": 7},
		"content": []any{map[string]any{"type": "text", "text": longText}},
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = src.Exec(`UPDATE session_message SET data=? WHERE id='m3'`, string(message)); err != nil {
		t.Fatal(err)
	}
	if _, err = src.Exec(`INSERT INTO session_message VALUES('m4','s','compaction',4,1300,'{"status":"completed","summary":"Saved context summary"}')`); err != nil {
		t.Fatal(err)
	}
	if _, err = src.Exec(`INSERT INTO session_message VALUES('m5','s','compaction',5,1400,'{"status":"failed","summary":""}')`); err != nil {
		t.Fatal(err)
	}
	src.Close()
	db, err := sql.Open("sqlite3", filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	a := &App{db: db, source: source}
	if err = a.initSchema(); err != nil {
		t.Fatal(err)
	}
	if err = a.importData(); err != nil {
		t.Fatal(err)
	}
	all, err := a.filtered(Filters{Models: map[string]bool{}})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 1 || all[0].Tokens.Total() != 30 {
		t.Fatalf("all = %+v", all)
	}
	one, err := a.filtered(Filters{Models: map[string]bool{"model-a": true}})
	if err != nil {
		t.Fatal(err)
	}
	if len(one) != 1 || one[0].Tokens.Total() != 15 {
		t.Fatalf("filtered = %+v", one)
	}
	both, err := a.filtered(Filters{Models: map[string]bool{"model-a": true, "model-b": true}})
	if err != nil {
		t.Fatal(err)
	}
	if len(both) != 1 || both[0].Tokens.Total() != 30 {
		t.Fatalf("both = %+v", both)
	}
	for _, check := range []struct {
		query  string
		models map[string]int64
	}{
		{"", map[string]int64{"model-a": 15, "model-b": 15}},
		{"?model=model-a", map[string]int64{"model-a": 15}},
	} {
		recorder := httptest.NewRecorder()
		a.dashboard(recorder, httptest.NewRequest("GET", "/api/dashboard"+check.query, nil))
		var result struct {
			Bars []struct {
				Models map[string]int64 `json:"models"`
			} `json:"bars"`
		}
		if err := json.Unmarshal(recorder.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		if len(result.Bars) != 1 || len(result.Bars[0].Models) != len(check.models) {
			t.Fatalf("query=%q bars=%+v", check.query, result.Bars)
		}
		for model, tokens := range check.models {
			if result.Bars[0].Models[model] != tokens {
				t.Fatalf("query=%q model=%q tokens=%d", check.query, model, result.Bars[0].Models[model])
			}
		}
	}
	var count int
	if err = db.QueryRow(`SELECT count(*) FROM actions WHERE session_id='s'`).Scan(&count); err != nil || count != 7 {
		t.Fatalf("actions count=%d err=%v", count, err)
	}
	if err = a.importData(); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT count(*) FROM actions WHERE session_id='s'`).Scan(&count); err != nil || count != 7 {
		t.Fatalf("repeat actions count=%d err=%v", count, err)
	}
	var detailText string
	if err = db.QueryRow(`SELECT detail FROM actions WHERE id='m3-0'`).Scan(&detailText); err != nil || detailText != longText {
		t.Fatalf("long action detail was truncated: length=%d err=%v", len(detailText), err)
	}
	var label, input, output, status string
	if err = db.QueryRow(`SELECT label,detail,status FROM actions WHERE id='m4'`).Scan(&label, &detailText, &status); err != nil || label != "Context compacted" || detailText != "Saved context summary" || status != "completed" {
		t.Fatalf("compaction action: label=%q detail=%q status=%q err=%v", label, detailText, status, err)
	}
	if err = db.QueryRow(`SELECT label,status FROM actions WHERE id='m5'`).Scan(&label, &status); err != nil || label != "Compaction failed" || status != "failed" {
		t.Fatalf("failed compaction action: label=%q status=%q err=%v", label, status, err)
	}
	for _, check := range []struct {
		name    string
		handler http.HandlerFunc
		method  string
		path    string
		status  int
		body    string
	}{
		{"status", a.status, "GET", "/api/status", 200, "\"sessions\":1"},
		{"options", a.options, "GET", "/api/options", 200, "model-a"},
		{"dashboard", a.dashboard, "GET", "/api/dashboard?model=model-a&model=model-b", 200, "\"sessions\":1"},
		{"bad filter", a.dashboard, "GET", "/api/dashboard?from=invalid", 400, "invalid from"},
		{"detail", a.detail, "GET", "/api/sessions/s", 200, "full read result"},
		{"missing detail", a.detail, "GET", "/api/sessions/missing", 404, "404"},
		{"refresh method", a.refresh, "GET", "/api/import", 405, "POST required"},
		{"refresh", a.refresh, "POST", "/api/import", 200, "\"sessions\":1"},
	} {
		t.Run(check.name, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			check.handler(recorder, httptest.NewRequest(check.method, check.path, nil))
			if recorder.Code != check.status || !strings.Contains(recorder.Body.String(), check.body) {
				t.Fatalf("status=%d body=%q", recorder.Code, recorder.Body.String())
			}
			if check.name == "status" && !strings.Contains(recorder.Body.String(), `"version":"`+version+`"`) {
				t.Fatalf("status omits app version: %q", recorder.Body.String())
			}
		})
	}
	if err := db.QueryRow(`SELECT label,input,output,status FROM actions WHERE kind='tool'`).Scan(&label, &input, &output, &status); err != nil || !strings.Contains(label, "/example/main.go") || !strings.Contains(input, `"filePath": "/example/main.go"`) || output != "full read result" || status != "completed" {
		t.Fatalf("tool details: label=%q input=%q output=%q status=%q err=%v", label, input, output, status, err)
	}
	src, err = sql.Open("sqlite3", source)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = src.Exec(`DELETE FROM session_message WHERE id='m5'`); err != nil {
		t.Fatal(err)
	}
	src.Close()
	if err = a.importData(); err != nil {
		t.Fatal(err)
	}
	if err = db.QueryRow(`SELECT count(*) FROM actions WHERE id='m5'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("removed source action was lost: count=%d err=%v", count, err)
	}
}

func TestImportCommandSelectionAndCounts(t *testing.T) {
	dir := t.TempDir()
	appPath := filepath.Join(dir, "app.db")
	codexPath := filepath.Join(dir, "sessions")
	if err := os.MkdirAll(codexPath, 0700); err != nil {
		t.Fatal(err)
	}
	rollout := `{"timestamp":"2026-01-01T10:00:00Z","type":"session_meta","payload":{"id":"one","cwd":"/work/example"}}` + "\n"
	if err := os.WriteFile(filepath.Join(codexPath, "one.jsonl"), []byte(rollout), 0600); err != nil {
		t.Fatal(err)
	}
	if err := runImport([]string{"--source", "codex", "--codex-source", codexPath, "--opencode-source", filepath.Join(dir, "missing.db"), "--db", appPath}); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(codexPath, "one.jsonl")); err != nil {
		t.Fatal(err)
	}
	if err := runImport([]string{"--source", "codex", "--codex-source", codexPath, "--db", appPath}); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite3", appPath)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var sessionCount int
	if err := db.QueryRow(`SELECT count(*) FROM sessions WHERE id='codex:one'`).Scan(&sessionCount); err != nil || sessionCount != 1 {
		t.Fatalf("removed source session was lost: count=%d err=%v", sessionCount, err)
	}
	app := &App{db: db, source: filepath.Join(dir, "missing.db"), codexSource: codexPath}
	results, err := app.importSources(map[string]bool{"codex": true})
	if err != nil || len(results) != 1 || results[0].newSessions != 0 {
		t.Fatalf("repeat import: %+v, %v", results, err)
	}
	if err := runImport([]string{"--source", "unknown", "--db", filepath.Join(dir, "invalid.db")}); err == nil {
		t.Fatal("unknown source accepted")
	}
	if _, err := os.Stat(filepath.Join(dir, "invalid.db")); !os.IsNotExist(err) {
		t.Fatalf("invalid source created database: %v", err)
	}
}

func TestLegacyImport(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.db")
	src, err := sql.Open("sqlite3", source)
	if err != nil {
		t.Fatal(err)
	}
	_, err = src.Exec(`CREATE TABLE project(id TEXT PRIMARY KEY,name TEXT);
CREATE TABLE session(id TEXT PRIMARY KEY,title TEXT,project_id TEXT,directory TEXT,parent_id TEXT,model TEXT,time_created INTEGER,time_updated INTEGER,tokens_input INTEGER,tokens_output INTEGER,tokens_reasoning INTEGER,tokens_cache_read INTEGER,tokens_cache_write INTEGER);
CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,time_created INTEGER,data TEXT);
CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,time_created INTEGER,data TEXT);
INSERT INTO project VALUES('p','Legacy');
INSERT INTO session VALUES('s','Old','p','/legacy',NULL,'{"id":"fallback"}',1000,2000,4,3,0,0,0);
INSERT INTO message VALUES('m','s',1000,'{"role":"assistant","model":{"id":"legacy-model"},"tokens":{"input":4,"output":3}}');
INSERT INTO message VALUES('legacy-compaction','s',1100,'{"role":"compaction","summary":"Legacy summary","status":"completed"}');
INSERT INTO part VALUES('part','m',1001,'{"type":"tool","name":"bash","state":{"title":"Legacy tool","input":{"command":"pwd"},"output":"/legacy","status":"completed"}}');`)
	if err != nil {
		t.Fatal(err)
	}
	longText := strings.Repeat("Legacy response line.\n", 200) + "Final line"
	part, err := json.Marshal(map[string]any{"type": "text", "text": longText})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = src.Exec(`INSERT INTO part VALUES('long-part','m',1002,?)`, string(part)); err != nil {
		t.Fatal(err)
	}
	src.Close()
	db, err := sql.Open("sqlite3", filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	app := &App{db: db, source: source}
	if err := app.initSchema(); err != nil {
		t.Fatal(err)
	}
	if err := app.importData(); err != nil {
		t.Fatal(err)
	}
	recorder := httptest.NewRecorder()
	app.detail(recorder, httptest.NewRequest("GET", "/api/sessions/s", nil))
	if recorder.Code != 200 || !strings.Contains(recorder.Body.String(), `"output":"/legacy"`) || !strings.Contains(recorder.Body.String(), `"label":"Tool · bash · pwd"`) {
		t.Fatalf("status=%d body=%q", recorder.Code, recorder.Body.String())
	}
	var input string
	if err := db.QueryRow(`SELECT input FROM actions WHERE id='part'`).Scan(&input); err != nil || !strings.Contains(input, `"command": "pwd"`) {
		t.Fatalf("legacy tool input=%q err=%v", input, err)
	}
	var detailText string
	if err := db.QueryRow(`SELECT detail FROM actions WHERE id='long-part'`).Scan(&detailText); err != nil || detailText != longText {
		t.Fatalf("legacy action detail was truncated: length=%d err=%v", len(detailText), err)
	}
	var label, status string
	if err := db.QueryRow(`SELECT label,detail,status FROM actions WHERE id='legacy-compaction'`).Scan(&label, &detailText, &status); err != nil || label != "Context compacted" || detailText != "Legacy summary" || status != "completed" {
		t.Fatalf("legacy compaction: label=%q detail=%q status=%q err=%v", label, detailText, status, err)
	}
}

func TestLegacyAppDatabaseRequiresConversion(t *testing.T) {
	db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if _, err := db.Exec(`CREATE TABLE sessions(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,directory TEXT NOT NULL,model TEXT NOT NULL,source TEXT NOT NULL); INSERT INTO sessions VALUES('s','p','/work','old-model','codex')`); err != nil {
		t.Fatal(err)
	}
	a := &App{db: db}
	if err := a.initSchema(); err == nil || !strings.Contains(err.Error(), "legacy app database") {
		t.Fatalf("expected legacy schema error, got %v", err)
	}
	var projects int
	if err := db.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='projects'`).Scan(&projects); err != nil || projects != 0 {
		t.Fatalf("legacy database was modified: projects=%d, err=%v", projects, err)
	}
}

func TestProjectNameFollowsLatestSession(t *testing.T) {
	db, err := sql.Open("sqlite3", filepath.Join(t.TempDir(), "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	a := &App{db: db}
	if err := a.initSchema(); err != nil {
		t.Fatal(err)
	}
	for _, session := range []Session{
		{ID: "new", ProjectID: "p", Project: "Current", Directory: "/work", Model: "model-a", Updated: 200, Source: "opencode"},
		{ID: "old", ProjectID: "p", Project: "Historical", Directory: "/work", Model: "model-a", Updated: 100, Source: "opencode"},
	} {
		tx, err := a.repository().Begin()
		if err != nil {
			t.Fatal(err)
		}
		if err := a.repository().SaveSession(tx, session); err != nil {
			t.Fatal(err)
		}
		if err := a.repository().SaveUsage(tx, session.ID, Usage{Model: "model-a", Tokens: Tokens{Input: 3}}); err != nil {
			t.Fatal(err)
		}
		if err := tx.Commit(); err != nil {
			t.Fatal(err)
		}
	}
	projects, _, folders, sources, err := a.repository().Options()
	if err != nil || len(projects) != 1 || projects[0]["name"] != "Current" {
		t.Fatalf("projects=%v, err=%v", projects, err)
	}
	if len(folders) != 1 || folders[0]["path"] != "/work" || len(sources) != 1 || sources[0]["name"] != "opencode" {
		t.Fatalf("folders=%v sources=%v", folders, sources)
	}
	for _, id := range []string{"new", "old"} {
		session, err := a.repository().Session(id)
		if err != nil || session.ProjectID != "p" || session.FolderID != folders[0]["id"] || session.Model != "model-a" || session.SourceID != sources[0]["id"] {
			t.Fatalf("session %s: %+v, %v", id, session, err)
		}
		usage, err := a.repository().Usage(id)
		if err != nil || len(usage) != 1 || usage[0].Model != "model-a" {
			t.Fatalf("usage %s: %+v, %v", id, usage, err)
		}
	}
	for _, table := range []string{"models", "folders", "sources"} {
		var count int
		if err := db.QueryRow(`SELECT count(*) FROM ` + table).Scan(&count); err != nil || count != 1 {
			t.Fatalf("%s rows=%d, err=%v", table, count, err)
		}
	}
}

func TestToolFieldsKeepFullOutputAndError(t *testing.T) {
	full := strings.Repeat("output line\n", 500)
	input, output, status := toolFields(map[string]any{"type": "tool", "state": map[string]any{"input": map[string]any{"command": "cat file"}, "output": full, "status": "completed"}})
	if !strings.Contains(input, `"command": "cat file"`) || output != full || status != "completed" {
		t.Fatalf("tool fields lost data: input=%q output length=%d status=%q", input, len(output), status)
	}
	_, output, status = toolFields(map[string]any{"type": "tool", "state": map[string]any{"error": "command failed", "status": "error"}})
	if output != "command failed" || status != "error" {
		t.Fatalf("tool error output=%q status=%q", output, status)
	}
	_, output, _ = toolFields(map[string]any{"type": "tool", "state": map[string]any{"content": []any{map[string]any{"type": "text", "text": "first line"}, map[string]any{"type": "text", "text": "second line"}}}})
	if output != "first line\nsecond line" {
		t.Fatalf("tool content output=%q", output)
	}
}
