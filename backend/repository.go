package main

import (
	"database/sql"
	"fmt"
	"os"
)

// Repository owns all access to the app's SQLite database.
type Repository struct{ db *sql.DB }

func (a *App) repository() *Repository { return &Repository{db: a.db} }

func (r *Repository) CountSessions(source string) (int, error) {
	var count int
	query := `SELECT count(*) FROM sessions`
	var err error
	if source == "" {
		err = r.db.QueryRow(query).Scan(&count)
	} else {
		err = r.db.QueryRow(query+` WHERE source_id=(SELECT id FROM sources WHERE name=?)`, source).Scan(&count)
	}
	return count, err
}

func (r *Repository) Options() ([]map[string]string, []string, []map[string]any, []map[string]any, error) {
	projects := []map[string]string{}
	models := []string{}
	folders := []map[string]any{}
	sources := []map[string]any{}
	rows, err := r.db.Query(`SELECT id,name FROM projects ORDER BY name,id`)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	for rows.Next() {
		var id, name string
		if err := rows.Scan(&id, &name); err != nil {
			closeAndLogError(rows)
			return nil, nil, nil, nil, err
		}
		projects = append(projects, map[string]string{"id": id, "name": name})
	}
	err = rows.Err()
	closeAndLogError(rows)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	rows, err = r.db.Query(`SELECT DISTINCT m.name FROM usage u JOIN models m ON m.id=u.model_id ORDER BY m.name`)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	for rows.Next() {
		var model string
		if err := rows.Scan(&model); err != nil {
			closeAndLogError(rows)
			return nil, nil, nil, nil, err
		}
		models = append(models, model)
	}
	err = rows.Err()
	closeAndLogError(rows)
	if err != nil {
		return nil, nil, nil, nil, err
	}
	for _, lookup := range []struct {
		query string
		label string
		out   *[]map[string]any
	}{
		{`SELECT id,path FROM folders ORDER BY path,id`, "path", &folders},
		{`SELECT id,name FROM sources ORDER BY name,id`, "name", &sources},
	} {
		rows, err = r.db.Query(lookup.query)
		if err != nil {
			return nil, nil, nil, nil, err
		}
		for rows.Next() {
			var id int64
			var name string
			if err = rows.Scan(&id, &name); err != nil {
				break
			}
			*lookup.out = append(*lookup.out, map[string]any{"id": id, lookup.label: name})
		}
		if err == nil {
			err = rows.Err()
		}
		closeAndLogError(rows)
		if err != nil {
			return nil, nil, nil, nil, err
		}
	}
	return projects, models, folders, sources, nil
}

const sessionColumns = `s.id,s.title,s.project_id,s.folder_id,s.parent_id,m.name,s.created,s.updated,s.input,s.output,s.reasoning,s.cache_read,s.cache_write,s.source_id,COALESCE(a.action_count,0),COALESCE(a.tool_calls,0)`
const sessionJoins = ` FROM sessions s JOIN models m ON m.id=s.model_id LEFT JOIN (SELECT session_id,COUNT(*) AS action_count,SUM(CASE WHEN kind='tool' THEN 1 ELSE 0 END) AS tool_calls FROM actions GROUP BY session_id) a ON a.session_id=s.id`

func scanSession(row interface{ Scan(...any) error }) (Session, error) {
	var s Session
	err := row.Scan(&s.ID, &s.Title, &s.ProjectID, &s.FolderID, &s.ParentID, &s.Model, &s.Created, &s.Updated, &s.Tokens.Input, &s.Tokens.Output, &s.Tokens.Reasoning, &s.Tokens.CacheRead, &s.Tokens.CacheWrite, &s.SourceID, &s.ActionCount, &s.ToolCalls)
	return s, err
}

func (r *Repository) Sessions() ([]Session, error) {
	rows, err := r.db.Query(`SELECT ` + sessionColumns + sessionJoins + ` ORDER BY s.updated DESC`)
	if err != nil {
		return nil, err
	}
	defer closeAndLogError(rows)
	sessions := []Session{}
	for rows.Next() {
		session, err := scanSession(rows)
		if err != nil {
			return nil, err
		}
		sessions = append(sessions, session)
	}
	return sessions, rows.Err()
}

func (r *Repository) Session(id string) (Session, error) {
	return scanSession(r.db.QueryRow(`SELECT `+sessionColumns+sessionJoins+` WHERE s.id=?`, id))
}

func (r *Repository) Usage(id string) ([]Usage, error) {
	rows, err := r.db.Query(`SELECT m.name,u.input,u.output,u.reasoning,u.cache_read,u.cache_write FROM usage u JOIN models m ON m.id=u.model_id WHERE u.session_id=? ORDER BY m.name`, id)
	if err != nil {
		return nil, err
	}
	defer closeAndLogError(rows)
	usage := []Usage{}
	for rows.Next() {
		var row Usage
		if err := rows.Scan(&row.Model, &row.Tokens.Input, &row.Tokens.Output, &row.Tokens.Reasoning, &row.Tokens.CacheRead, &row.Tokens.CacheWrite); err != nil {
			return nil, err
		}
		usage = append(usage, row)
	}
	return usage, rows.Err()
}

func (r *Repository) UsageBySession() (map[string][]Usage, error) {
	rows, err := r.db.Query(`SELECT u.session_id,m.name,u.input,u.output,u.reasoning,u.cache_read,u.cache_write FROM usage u JOIN models m ON m.id=u.model_id ORDER BY u.session_id,m.name`)
	if err != nil {
		return nil, err
	}
	defer closeAndLogError(rows)
	usage := map[string][]Usage{}
	for rows.Next() {
		var sessionID string
		var row Usage
		if err := rows.Scan(&sessionID, &row.Model, &row.Tokens.Input, &row.Tokens.Output, &row.Tokens.Reasoning, &row.Tokens.CacheRead, &row.Tokens.CacheWrite); err != nil {
			return nil, err
		}
		usage[sessionID] = append(usage[sessionID], row)
	}
	return usage, rows.Err()
}

func (r *Repository) Actions(id string) ([]Action, error) {
	rows, err := r.db.Query(`SELECT id,parent_id,kind,label,detail,created,ord,input,output,status FROM actions WHERE session_id=? ORDER BY ord`, id)
	if err != nil {
		return nil, err
	}
	defer closeAndLogError(rows)
	actions := []Action{}
	for rows.Next() {
		var action Action
		if err := rows.Scan(&action.ID, &action.ParentID, &action.Kind, &action.Label, &action.Detail, &action.Created, &action.Ord, &action.Input, &action.Output, &action.Status); err != nil {
			return nil, err
		}
		actions = append(actions, action)
	}
	return actions, rows.Err()
}

func (r *Repository) Begin() (*sql.Tx, error) { return r.db.Begin() }

func (r *Repository) SaveSession(tx *sql.Tx, s Session) error {
	if _, err := tx.Exec(`INSERT INTO projects(id,name,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated=excluded.updated WHERE excluded.updated>=projects.updated`, s.ProjectID, s.Project, s.Updated); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO folders(path) VALUES(?) ON CONFLICT DO NOTHING`, s.Directory); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO models(name) VALUES(?) ON CONFLICT DO NOTHING`, s.Model); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO sources(name) VALUES(?) ON CONFLICT DO NOTHING`, s.Source); err != nil {
		return err
	}
	_, err := tx.Exec(`INSERT INTO sessions(id,title,project_id,folder_id,parent_id,model_id,created,updated,input,output,reasoning,cache_read,cache_write,source_id) VALUES(?,?,?,(SELECT id FROM folders WHERE path=?),?,(SELECT id FROM models WHERE name=?),?,?,?,?,?,?,?,(SELECT id FROM sources WHERE name=?)) ON CONFLICT(id) DO UPDATE SET title=excluded.title,project_id=excluded.project_id,folder_id=excluded.folder_id,parent_id=excluded.parent_id,model_id=excluded.model_id,created=excluded.created,updated=excluded.updated,input=excluded.input,output=excluded.output,reasoning=excluded.reasoning,cache_read=excluded.cache_read,cache_write=excluded.cache_write,source_id=excluded.source_id`, s.ID, s.Title, s.ProjectID, s.Directory, s.ParentID, s.Model, s.Created, s.Updated, s.Tokens.Input, s.Tokens.Output, s.Tokens.Reasoning, s.Tokens.CacheRead, s.Tokens.CacheWrite, s.Source)
	return err
}

func (r *Repository) SaveAction(tx *sql.Tx, sessionID string, action Action) error {
	_, err := tx.Exec(`INSERT INTO actions(id,session_id,parent_id,kind,label,detail,created,ord,input,output,status) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,kind=excluded.kind,label=excluded.label,detail=excluded.detail,created=excluded.created,ord=excluded.ord,input=excluded.input,output=excluded.output,status=excluded.status`, action.ID, sessionID, action.ParentID, action.Kind, action.Label, action.Detail, action.Created, action.Ord, action.Input, action.Output, action.Status)
	return err
}

func (r *Repository) SaveUsage(tx *sql.Tx, sessionID string, row Usage) error {
	if _, err := tx.Exec(`INSERT INTO models(name) VALUES(?) ON CONFLICT DO NOTHING`, row.Model); err != nil {
		return err
	}
	_, err := tx.Exec(`INSERT INTO usage(session_id,model_id,input,output,reasoning,cache_read,cache_write) VALUES(?,(SELECT id FROM models WHERE name=?),?,?,?,?,?) ON CONFLICT(session_id,model_id) DO UPDATE SET input=excluded.input,output=excluded.output,reasoning=excluded.reasoning,cache_read=excluded.cache_read,cache_write=excluded.cache_write`, sessionID, row.Model, row.Tokens.Input, row.Tokens.Output, row.Tokens.Reasoning, row.Tokens.CacheRead, row.Tokens.CacheWrite)
	return err
}

// SourceRepository reads the user's OpenCode database without modifying it.
type SourceRepository struct{ db *sql.DB }

func openSource(path string) (*sql.DB, error) {
	return openSQLiteSource(path, "OpenCode")
}

func openSQLiteSource(path, source string) (*sql.DB, error) {
	if _, err := os.Stat(path); err != nil {
		return nil, fmt.Errorf("%s database unavailable at %s: %w", source, path, err)
	}
	db, err := sql.Open("sqlite3", "file:"+path+"?mode=ro&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		closeAndLogError(db)
		return nil, err
	}
	return db, nil
}

func (r *SourceRepository) TableExists(name string) bool {
	var count int
	_ = r.db.QueryRow("SELECT count(*) FROM sqlite_master WHERE type='table' AND name=?", name).Scan(&count)
	return count > 0
}

func (r *SourceRepository) Sessions(schema sourceSchema) (*sql.Rows, error) {
	// Only known schemas supplied by the importer reach this query.
	return r.db.Query(fmt.Sprintf(`SELECT s.id,COALESCE(s.title,''),s.project_id,COALESCE(p.name,''),s.directory,COALESCE(s.parent_id,''),COALESCE(s.model,''),s.time_created,s.time_updated,s.tokens_input,s.tokens_output,s.tokens_reasoning,s.tokens_cache_read,s.tokens_cache_write FROM %s s LEFT JOIN project p ON p.id=s.project_id`, schema.session))
}
func (r *SourceRepository) Messages(sessionID string, schema sourceSchema) (*sql.Rows, error) {
	if schema.part == "" {
		return r.db.Query(`SELECT id,type,data,time_created FROM session_message WHERE session_id=? ORDER BY seq,time_created`, sessionID)
	}
	return r.db.Query(`SELECT id,'',data,time_created FROM message WHERE session_id=? ORDER BY time_created,id`, sessionID)
}
func (r *SourceRepository) Parts(messageID string) (*sql.Rows, error) {
	return r.db.Query(`SELECT id,data,time_created FROM part WHERE message_id=? ORDER BY time_created,id`, messageID)
}
