package main

import (
	"database/sql"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	_ "github.com/mattn/go-sqlite3"
)

// version is set by release builds. Local builds use dev unless overridden.
var version = "dev"

//go:embed web-dist
var webFiles embed.FS

func webHandler() http.Handler {
	files, err := fs.Sub(webFiles, "web-dist")
	if err != nil {
		panic(err)
	}
	return http.FileServer(http.FS(files))
}

func defaultDatabasePath() string {
	dir, err := os.UserConfigDir()
	if err != nil {
		log.Fatalf("find user configuration directory: %v", err)
	}
	return filepath.Join(dir, "agentstat", "agentstat.db")
}

func main() {
	if len(os.Args) > 1 && os.Args[1] == "import" {
		if err := runImport(os.Args[2:]); err != nil {
			log.Fatal(err)
		}
		return
	}
	if len(os.Args) > 1 && !strings.HasPrefix(os.Args[1], "-") {
		log.Fatalf("unknown command %q", os.Args[1])
	}
	home, _ := os.UserHomeDir()
	source := flag.String("source", env("OPENCODE_DB", filepath.Join(home, ".local/share/opencode/opencode.db")), "OpenCode SQLite database")
	codexSource := flag.String("codex-source", env("CODEX_SESSIONS", filepath.Join(home, ".codex/sessions")), "Codex sessions directory")
	copilotSource := flag.String("copilot-source", env("COPILOT_SESSIONS", filepath.Join(home, ".copilot/session-state")), "GitHub Copilot IDEA session-state directory")
	kiloSource := flag.String("kilo-source", env("KILO_DB", filepath.Join(home, ".local/share/kilo/kilo.db")), "Kilo Code SQLite database")
	database := flag.String("db", env("AGENTSTAT_DB", defaultDatabasePath()), "app SQLite database")
	addr := flag.String("addr", env("AGENTSTAT_ADDR", "127.0.0.1:8080"), "listen address")
	showVersion := flag.Bool("version", false, "print the app version and exit")
	flag.Parse()
	if *showVersion {
		fmt.Println("agentstat " + version)
		return
	}
	if err := os.MkdirAll(filepath.Dir(*database), 0700); err != nil {
		log.Fatal(err)
	}
	db, err := sql.Open("sqlite3", *database+"?_busy_timeout=5000&_journal_mode=WAL")
	if err != nil {
		log.Fatal(err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	app := &App{db: db, source: *source, codexSource: *codexSource, copilotSource: *copilotSource, kiloSource: *kiloSource}
	if err := app.initSchema(); err != nil {
		log.Fatal(err)
	}
	if err := app.importData(); err != nil {
		app.importErr = err.Error()
		log.Printf("initial import: %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/api/status", app.status)
	mux.HandleFunc("/api/import", app.refresh)
	mux.HandleFunc("/api/options", app.options)
	mux.HandleFunc("/api/dashboard", app.dashboard)
	mux.HandleFunc("/api/sessions/", app.detail)
	mux.Handle("/", webHandler())
	log.Printf("Agent Stats at http://%s", *addr)
	log.Fatal(http.ListenAndServe(*addr, mux))
}

// runImport parses command-specific flags separately from the historical server flags.
// In server mode -source still names the OpenCode database; in import mode it
// selects one or more source names.
func runImport(args []string) error {
	home, _ := os.UserHomeDir()
	flags := flag.NewFlagSet("import", flag.ContinueOnError)
	selection := flags.String("source", "", "comma-separated sources: opencode,codex,copilot,kilo (default: all)")
	opencodePath := flags.String("opencode-source", env("OPENCODE_DB", filepath.Join(home, ".local/share/opencode/opencode.db")), "OpenCode SQLite database")
	codexPath := flags.String("codex-source", env("CODEX_SESSIONS", filepath.Join(home, ".codex/sessions")), "Codex sessions directory")
	copilotPath := flags.String("copilot-source", env("COPILOT_SESSIONS", filepath.Join(home, ".copilot/session-state")), "GitHub Copilot IDEA session-state directory")
	kiloPath := flags.String("kilo-source", env("KILO_DB", filepath.Join(home, ".local/share/kilo/kilo.db")), "Kilo Code SQLite database")
	database := flags.String("db", env("AGENTSTAT_DB", defaultDatabasePath()), "app SQLite database")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected arguments: %s", strings.Join(flags.Args(), " "))
	}
	app := &App{source: *opencodePath, codexSource: *codexPath, copilotSource: *copilotPath, kiloSource: *kiloPath}
	available := map[string]bool{}
	for _, source := range app.sources() {
		available[source.name] = true
	}
	selected := map[string]bool{}
	if *selection == "" {
		for name := range available {
			selected[name] = true
		}
	} else {
		for _, name := range strings.Split(*selection, ",") {
			name = strings.TrimSpace(name)
			if !available[name] {
				return fmt.Errorf("unknown source %q (available: opencode,codex,copilot,kilo)", name)
			}
			selected[name] = true
		}
	}
	if err := os.MkdirAll(filepath.Dir(*database), 0700); err != nil {
		return err
	}
	db, err := sql.Open("sqlite3", *database+"?_busy_timeout=5000&_journal_mode=WAL")
	if err != nil {
		return err
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	app.db = db
	if err := app.initSchema(); err != nil {
		return err
	}
	results, importErr := app.importSources(selected)
	total := 0
	for _, result := range results {
		total += result.newSessions
		if result.err != nil {
			log.Printf("%s: error: %v (%d new sessions imported)", result.name, result.err, result.newSessions)
		} else {
			log.Printf("%s: %d new sessions imported", result.name, result.newSessions)
		}
	}
	log.Printf("import complete: %d new sessions imported", total)
	return importErr
}

func env(k, fallback string) string {
	if value := os.Getenv(k); value != "" {
		return value
	}
	return fallback
}
