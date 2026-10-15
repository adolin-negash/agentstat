package main

import (
	"database/sql"
	"time"
)

type App struct {
	db               *sql.DB
	databasePath     string
	serverAddress    string
	source           string
	codexSource      string
	copilotSource    string
	kiloSource       string
	lastImport       time.Time
	importedSessions int
	importErr        string
}

type Tokens struct {
	Input      int64 `json:"input"`
	Output     int64 `json:"output"`
	Reasoning  int64 `json:"reasoning"`
	CacheRead  int64 `json:"cacheRead"`
	CacheWrite int64 `json:"cacheWrite"`
}

func (t Tokens) Total() int64 { return t.Input + t.Output + t.Reasoning + t.CacheRead + t.CacheWrite }
func (t *Tokens) Add(other Tokens) {
	t.Input += other.Input
	t.Output += other.Output
	t.Reasoning += other.Reasoning
	t.CacheRead += other.CacheRead
	t.CacheWrite += other.CacheWrite
}

type Session struct {
	ID          string           `json:"id"`
	Source      string           `json:"-"`
	Title       string           `json:"title"`
	ProjectID   string           `json:"projectId"`
	Project     string           `json:"-"`
	FolderID    int64            `json:"folderId"`
	Directory   string           `json:"-"`
	SourceID    int64            `json:"sourceId"`
	ParentID    string           `json:"parentId,omitempty"`
	Model       string           `json:"model"`
	Created     int64            `json:"created"`
	Updated     int64            `json:"updated"`
	ActionCount int64            `json:"actionCount"`
	ToolCalls   int64            `json:"toolCalls"`
	Tokens      Tokens           `json:"tokens"`
	Models      []string         `json:"models"`
	ModelTokens map[string]int64 `json:"-"`
}
type Action struct {
	ID       string `json:"id"`
	ParentID string `json:"parentId,omitempty"`
	Kind     string `json:"kind"`
	Label    string `json:"label"`
	Detail   string `json:"detail,omitempty"`
	Input    string `json:"input,omitempty"`
	Output   string `json:"output,omitempty"`
	Status   string `json:"status,omitempty"`
	Created  int64  `json:"created"`
	Ord      int    `json:"order"`
}
type Usage struct {
	Model  string `json:"model"`
	Tokens Tokens `json:"tokens"`
}
type Filters struct {
	From, To             int64
	Name                 string
	Regex, CaseSensitive bool
	Projects             map[string]bool
	Models               map[string]bool
	Sources              map[int64]bool
}
