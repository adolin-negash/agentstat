package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"path/filepath"
)

// Kilo Code's current local history uses an OpenCode-derived SQLite schema.
// Read it independently so source IDs and project IDs cannot collide.
func (a *App) importKilo() error {
	src, err := openSQLiteSource(a.kiloSource, "Kilo Code")
	if err != nil {
		return err
	}
	defer closeAndLogError(src)
	reader := &SourceRepository{db: src}
	if !reader.TableExists("session") || !reader.TableExists("message") || !reader.TableExists("part") {
		return fmt.Errorf("kilo code database has no supported session, message, and part tables")
	}
	rows, err := src.Query(`SELECT s.id,COALESCE(s.title,''),COALESCE(s.project_id,''),COALESCE(p.name,''),COALESCE(s.directory,''),COALESCE(s.parent_id,''),s.time_created,s.time_updated FROM session s LEFT JOIN project p ON p.id=s.project_id ORDER BY s.time_created,s.id`)
	if err != nil {
		return err
	}
	defer closeAndLogError(rows)
	count := 0
	for rows.Next() {
		var s Session
		var sourceID, projectID string
		if err := rows.Scan(&sourceID, &s.Title, &projectID, &s.Project, &s.Directory, &s.ParentID, &s.Created, &s.Updated); err != nil {
			return err
		}
		s.ID = "kilo:" + sourceID
		s.Source = "kilo"
		if projectID == "" {
			projectID = s.Directory
		}
		s.ProjectID = "kilo:" + projectID
		if s.Project == "" {
			s.Project = filepath.Base(s.Directory)
		}
		if s.Project == "" || s.Project == "." {
			s.Project = "Unknown project"
		}
		if s.Title == "" {
			s.Title = "Untitled Kilo session"
		}
		if s.ParentID != "" {
			s.ParentID = "kilo:" + s.ParentID
		}
		if err := a.importKiloSession(src, sourceID, s); err != nil {
			return fmt.Errorf("session %s: %w", sourceID, err)
		}
		count++
	}
	if err := rows.Err(); err != nil {
		return err
	}
	log.Printf("scanned %d Kilo Code sessions", count)
	return nil
}

func (a *App) importKiloSession(src *sql.DB, sourceID string, session Session) error {
	rows, err := src.Query(`SELECT id,data,time_created FROM message WHERE session_id=? ORDER BY time_created,id`, sourceID)
	if err != nil {
		return err
	}
	defer closeAndLogError(rows)
	actions := []Action{}
	usage := map[string]Tokens{}
	model := "Unknown"
	for rows.Next() {
		var messageID, raw string
		var created int64
		if err := rows.Scan(&messageID, &raw, &created); err != nil {
			return err
		}
		var message map[string]any
		if err := json.Unmarshal([]byte(raw), &message); err != nil {
			return fmt.Errorf("message %s: %w", messageID, err)
		}
		kind := str(message["role"])
		if kind == "" {
			continue
		}
		id := "kilo:" + messageID
		messageModel := modelNameJSON(message)
		if messageModel == "Unknown" {
			messageModel = modelNameJSON(message["model"])
		}
		if kind == "assistant" {
			if messageModel != "Unknown" {
				model = messageModel
			}
			if tokenData, ok := message["tokens"].(map[string]any); ok {
				tokens := usage[messageModel]
				tokens.Add(tokenFromMap(tokenData))
				usage[messageModel] = tokens
			}
		}
		label := actionKindLabel(kind)
		if kind == "assistant" {
			label = "Assistant · " + messageModel
		}
		actions = append(actions, Action{ID: id, Kind: kind, Label: label, Created: created, Ord: len(actions) + 1})
		parts, err := (&SourceRepository{db: src}).Parts(messageID)
		if err != nil {
			return err
		}
		for parts.Next() {
			var partID, partRaw string
			var partCreated int64
			if err := parts.Scan(&partID, &partRaw, &partCreated); err != nil {
				closeAndLogError(parts)
				return err
			}
			var part map[string]any
			if err := json.Unmarshal([]byte(partRaw), &part); err != nil {
				closeAndLogError(parts)
				return fmt.Errorf("part %s: %w", partID, err)
			}
			partLabel, detail := partText(part)
			input, output, status := toolFields(part)
			actions = append(actions, Action{ID: "kilo:" + partID, ParentID: id, Kind: str(part["type"]), Label: partLabel, Detail: detail, Input: input, Output: output, Status: status, Created: partCreated, Ord: len(actions) + 1})
		}
		err = parts.Err()
		closeAndLogError(parts)
		if err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(usage) == 0 {
		usage[model] = Tokens{}
	}
	session.Model = model
	for _, tokens := range usage {
		session.Tokens.Add(tokens)
	}
	tx, err := a.repository().Begin()
	if err != nil {
		return err
	}
	defer rollbackIfOpen(tx)
	if err := a.repository().SaveSession(tx, session); err != nil {
		return err
	}
	for _, action := range actions {
		if err := a.repository().SaveAction(tx, session.ID, action); err != nil {
			return err
		}
	}
	for name, tokens := range usage {
		if err := a.repository().SaveUsage(tx, session.ID, Usage{Model: name, Tokens: tokens}); err != nil {
			return err
		}
	}
	return tx.Commit()
}
