package main

import (
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEmbeddedWebFiles(t *testing.T) {
	oldDir, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(t.TempDir()); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(oldDir) })

	web := webHandler()
	index := httptest.NewRecorder()
	web.ServeHTTP(index, httptest.NewRequest(http.MethodGet, "/", nil))
	if index.Code != http.StatusOK || !strings.Contains(index.Body.String(), "<html") {
		t.Fatalf("index: status=%d body=%q", index.Code, index.Body.String())
	}

	assets, err := fs.ReadDir(webFiles, "web-dist/assets")
	if err != nil || len(assets) == 0 {
		t.Fatalf("embedded assets: %v, %v", assets, err)
	}
	for _, asset := range assets {
		response := httptest.NewRecorder()
		web.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/assets/"+asset.Name(), nil))
		if response.Code != http.StatusOK || response.Body.Len() == 0 {
			t.Fatalf("asset %q: status=%d length=%d", asset.Name(), response.Code, response.Body.Len())
		}
	}
}

func TestDefaultDatabasePathIsUserOwned(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("HOME", dir)
	t.Setenv("XDG_CONFIG_HOME", dir)
	configDir, err := os.UserConfigDir()
	if err != nil {
		t.Fatal(err)
	}
	path := defaultDatabasePath()
	if path != filepath.Join(configDir, "agentstat", "agentstat.db") {
		t.Fatalf("default database path = %q", path)
	}
}
