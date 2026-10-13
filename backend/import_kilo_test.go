package main

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestImportKilo(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "kilo.db")
	src, err := sql.Open("sqlite3", source)
	if err != nil {
		t.Fatal(err)
	}
	_, err = src.Exec(`CREATE TABLE project(id TEXT PRIMARY KEY,name TEXT);
CREATE TABLE session(id TEXT PRIMARY KEY,title TEXT,project_id TEXT,directory TEXT,parent_id TEXT,time_created INTEGER,time_updated INTEGER);
CREATE TABLE message(id TEXT PRIMARY KEY,session_id TEXT,data TEXT,time_created INTEGER);
CREATE TABLE part(id TEXT PRIMARY KEY,message_id TEXT,data TEXT,time_created INTEGER);
INSERT INTO project VALUES('project-1','Example');
INSERT INTO session VALUES('same-id','Build a page','project-1','/work/example',NULL,1000,2000);
INSERT INTO message VALUES('user-1','same-id','{"role":"user"}',1000);
INSERT INTO part VALUES('part-1','user-1','{"type":"text","text":"Build a page"}',1001);
INSERT INTO message VALUES('assistant-1','same-id','{"role":"assistant","modelID":"model-a","tokens":{"input":10,"output":5,"reasoning":2,"cache":{"read":3,"write":1}}}',1100);
INSERT INTO part VALUES('part-2','assistant-1','{"type":"tool","tool":"read","state":{"status":"completed","input":{"filePath":"/work/example/main.go"},"output":"file contents"}}',1101);
INSERT INTO message VALUES('assistant-2','same-id','{"role":"assistant","modelID":"model-b","tokens":{"input":7,"output":4,"cache":{"read":2}}}',1200);
INSERT INTO part VALUES('part-3','assistant-2','{"type":"text","text":"Done"}',1201);`)
	if err != nil {
		t.Fatal(err)
	}
	src.Close()
	db, err := sql.Open("sqlite3", filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	app := &App{db: db, kiloSource: source}
	if err := app.initSchema(); err != nil {
		t.Fatal(err)
	}
	if err := app.importKilo(); err != nil {
		t.Fatal(err)
	}
	session, err := app.repository().Session("kilo:same-id")
	if err != nil {
		t.Fatal(err)
	}
	if session.ProjectID != "kilo:project-1" || session.Model != "model-b" || session.Tokens.Total() != 34 {
		t.Fatalf("session=%+v", session)
	}
	actions, err := app.repository().Actions(session.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 6 || actions[3].Input == "" || actions[3].Output != "file contents" || actions[3].ParentID != "kilo:assistant-1" {
		t.Fatalf("actions=%+v", actions)
	}
	filtered, err := app.filtered(Filters{Models: map[string]bool{"model-a": true}})
	if err != nil || len(filtered) != 1 || filtered[0].Tokens.Total() != 21 {
		t.Fatalf("filtered=%+v err=%v", filtered, err)
	}
	if err := app.importKilo(); err != nil {
		t.Fatal(err)
	}
	if count, err := app.repository().CountSessions("kilo"); err != nil || count != 1 {
		t.Fatalf("count=%d err=%v", count, err)
	}
	results, err := app.importSources(map[string]bool{"kilo": true})
	if err != nil || len(results) != 1 || results[0].name != "kilo" || results[0].newSessions != 0 {
		t.Fatalf("results=%+v err=%v", results, err)
	}
	if err := runImport([]string{"--source", "kilo", "--kilo-source", source, "--db", filepath.Join(dir, "headless.db")}); err != nil {
		t.Fatalf("headless import: %v", err)
	}
}
