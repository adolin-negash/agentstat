package main

import (
	"database/sql"
	"path/filepath"
	"testing"
)

func TestOpenCodeSpecialEvents(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "source.db")
	src, err := sql.Open("sqlite3", source)
	if err != nil {
		t.Fatal(err)
	}
	_, err = src.Exec(`CREATE TABLE project(id TEXT PRIMARY KEY,name TEXT);
CREATE TABLE session_v2(id TEXT PRIMARY KEY,title TEXT,project_id TEXT,directory TEXT,parent_id TEXT,model TEXT,time_created INTEGER,time_updated INTEGER,tokens_input INTEGER,tokens_output INTEGER,tokens_reasoning INTEGER,tokens_cache_read INTEGER,tokens_cache_write INTEGER);
CREATE TABLE session_message(id TEXT PRIMARY KEY,session_id TEXT,type TEXT,seq INTEGER,time_created INTEGER,data TEXT);
INSERT INTO project VALUES('p','Project');
INSERT INTO session_v2 VALUES('s','Special events','p','/project',NULL,'{"id":"model"}',1000,2000,0,0,0,0,0);
INSERT INTO session_message VALUES('m1','s','assistant',1,1100,'{"error":{"type":"aborted","message":"Stopped by user"}}');
INSERT INTO session_message VALUES('m2','s','assistant',2,1200,'{"finish":"length"}');
INSERT INTO session_message VALUES('m3','s','assistant',3,1300,'{"error":{"type":"provider.quota","message":"Quota exhausted"}}');
INSERT INTO session_message VALUES('m4','s','agent-switched',4,1400,'{"agent":"reviewer"}');`)
	if err != nil {
		t.Fatal(err)
	}
	closeAndLogError(src)
	db, err := sql.Open("sqlite3", filepath.Join(dir, "app.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer closeAndLogError(db)
	app := &App{db: db, source: source}
	if err := app.initSchema(); err != nil {
		t.Fatal(err)
	}
	if err := app.importData(); err != nil {
		t.Fatal(err)
	}
	actions, err := app.repository().Actions("s")
	if err != nil {
		t.Fatal(err)
	}
	if len(actions) != 7 || actions[1].Kind != "abort" || actions[1].Detail != "Stopped by user" || actions[3].Kind != "limit" || actions[5].Kind != "error" || actions[6].Kind != "agent-switched" || actions[6].Detail != "reviewer" {
		t.Fatalf("actions=%+v", actions)
	}
}
