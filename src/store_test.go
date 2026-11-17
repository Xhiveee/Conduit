package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCorruptedSettingsAreQuarantined(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	if err := os.WriteFile(filepath.Join(dir, "conduit.json"), []byte("{ not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	s, err := NewStore()
	if err != nil {
		t.Fatalf("NewStore: %v", err)
	}
	if len(s.Warnings()) == 0 {
		t.Fatal("expected a warning about the corrupted settings")
	}
	if s.GetSettings().ThemeID == "" {
		t.Fatal("default settings were not applied")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, e := range entries {
		if strings.Contains(e.Name(), ".corrupt-") {
			found = true
		}
	}
	if !found {
		t.Fatal("corrupted settings were not backed up")
	}
}
