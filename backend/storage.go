package main

import "fmt"

func (a *App) initSchema() error { return a.repository().InitSchema() }

func (r *Repository) InitSchema() error {
	var legacyColumn int
	if err := r.db.QueryRow(`SELECT count(*) FROM pragma_table_info('sessions') WHERE name IN ('project','directory','model','source')`).Scan(&legacyColumn); err != nil {
		return err
	}
	if legacyColumn != 0 {
		return fmt.Errorf("legacy app database schema: back up and convert the app database before starting this version")
	}
	_, err := r.db.Exec(`CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,name TEXT NOT NULL,updated INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS models(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS folders(id INTEGER PRIMARY KEY,path TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY,name TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,title TEXT NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),folder_id INTEGER NOT NULL REFERENCES folders(id),parent_id TEXT NOT NULL,model_id INTEGER NOT NULL REFERENCES models(id),created INTEGER NOT NULL,updated INTEGER NOT NULL,input INTEGER NOT NULL,output INTEGER NOT NULL,reasoning INTEGER NOT NULL,cache_read INTEGER NOT NULL,cache_write INTEGER NOT NULL,source_id INTEGER NOT NULL REFERENCES sources(id));
CREATE TABLE IF NOT EXISTS actions(id TEXT PRIMARY KEY,session_id TEXT NOT NULL,parent_id TEXT NOT NULL,kind TEXT NOT NULL,label TEXT NOT NULL,detail TEXT NOT NULL,created INTEGER NOT NULL,ord INTEGER NOT NULL,input TEXT NOT NULL DEFAULT '',output TEXT NOT NULL DEFAULT '',status TEXT NOT NULL DEFAULT '');
CREATE INDEX IF NOT EXISTS actions_session ON actions(session_id,ord);
CREATE TABLE IF NOT EXISTS usage(session_id TEXT NOT NULL,model_id INTEGER NOT NULL REFERENCES models(id),input INTEGER NOT NULL,output INTEGER NOT NULL,reasoning INTEGER NOT NULL,cache_read INTEGER NOT NULL,cache_write INTEGER NOT NULL,PRIMARY KEY(session_id,model_id));`)
	if err != nil {
		return err
	}
	return nil
}
