package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
)

func (a *App) importActions(src *sql.DB, tx *sql.Tx, session Session, schema sourceSchema) error {
	usage := map[string]Tokens{}
	order := 0
	rows, err := (&SourceRepository{db: src}).Messages(session.ID, schema)
	if err != nil {
		return err
	}
	defer closeAndLogError(rows)
	add := func(id, parent, kind, label, detail, input, output, status string, created int64) error {
		order++
		return a.repository().SaveAction(tx, session.ID, Action{ID: id, ParentID: parent, Kind: kind, Label: clip(label, 180), Detail: detail, Input: input, Output: output, Status: status, Created: created, Ord: order})
	}
	for rows.Next() {
		var id, kind, raw string
		var created int64
		if err := rows.Scan(&id, &kind, &raw, &created); err != nil {
			return err
		}
		var message map[string]any
		if json.Unmarshal([]byte(raw), &message) != nil {
			continue
		}
		if schema.part != "" {
			kind = str(message["role"])
		}
		model := modelNameJSON(message["model"])
		if model == "Unknown" {
			model = modelNameJSON(message)
		}
		if kind == "assistant" {
			if data, ok := message["tokens"].(map[string]any); ok {
				tokens := usage[model]
				tokens.Add(tokenFromMap(data))
				usage[model] = tokens
			}
		}
		label, detail := actionKindLabel(kind), ""
		status := ""
		if kind == "user" || kind == "synthetic" || kind == "system" {
			detail = str(message["text"])
			if clipped := clip(detail, 120); clipped != "" {
				label = clipped
			}
		}
		if kind == "assistant" {
			label = "Assistant · " + model
		}
		if kind == "compaction" {
			status = str(message["status"])
			label = "Context compacted"
			if status == "failed" {
				label = "Compaction failed"
			}
			detail = str(message["summary"])
		}
		if kind == "agent-switched" {
			label = "Agent switched"
			detail = str(message["agent"])
			if previous := str(message["previous"]); previous != "" {
				detail = previous + " → " + detail
			}
		}
		if err := add(id, "", kind, label, detail, "", "", status, created); err != nil {
			return err
		}
		if kind == "assistant" {
			failure := asMap(message["error"])
			errorType, errorMessage := str(failure["type"]), str(failure["message"])
			if errorType == "" {
				errorType = str(failure["name"])
			}
			if errorType != "" || errorMessage != "" {
				eventKind, eventLabel := sourceErrorEvent(errorType, errorMessage)
				if err := add(id+":event", "", eventKind, eventLabel, errorMessage, "", "", errorType, created); err != nil {
					return err
				}
			} else if str(message["finish"]) == "length" {
				if err := add(id+":event", "", "limit", "Model token limit reached", "", "", "", "length", created); err != nil {
					return err
				}
			}
		}
		if schema.part == "" {
			if content, ok := message["content"].([]any); ok {
				for index, item := range content {
					part := asMap(item)
					partLabel, partDetail := partText(part)
					input, output, status := toolFields(part)
					if err := add(fmt.Sprintf("%s-%d", id, index), id, str(part["type"]), partLabel, partDetail, input, output, status, created+int64(index)); err != nil {
						return err
					}
				}
			}
		} else if err := importLegacyParts(src, id, add); err != nil {
			return err
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(usage) == 0 {
		usage[session.Model] = session.Tokens
	}
	for model, tokens := range usage {
		if err := a.repository().SaveUsage(tx, session.ID, Usage{Model: model, Tokens: tokens}); err != nil {
			return err
		}
	}
	return nil
}

func importLegacyParts(src *sql.DB, messageID string, add func(string, string, string, string, string, string, string, string, int64) error) error {
	parts, err := (&SourceRepository{db: src}).Parts(messageID)
	if err != nil {
		return err
	}
	defer closeAndLogError(parts)
	for parts.Next() {
		var id, raw string
		var created int64
		if err := parts.Scan(&id, &raw, &created); err != nil {
			return err
		}
		var part map[string]any
		if json.Unmarshal([]byte(raw), &part) != nil {
			continue
		}
		label, detail := partText(part)
		input, output, status := toolFields(part)
		if err := add(id, messageID, str(part["type"]), label, detail, input, output, status, created); err != nil {
			return err
		}
	}
	return parts.Err()
}
