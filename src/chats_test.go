package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCorruptedChatIsQuarantined(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	chatsDir := filepath.Join(dir, "chats")
	if err := os.MkdirAll(chatsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(chatsDir, "bad.json"), []byte("{ broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	cs, err := NewChatStore()
	if err != nil {
		t.Fatalf("NewChatStore: %v", err)
	}
	if len(cs.Warnings()) == 0 {
		t.Fatal("expected a warning about the corrupted chat")
	}
	if _, err := os.Stat(filepath.Join(chatsDir, "corrupt", "bad.json")); err != nil {
		t.Fatalf("corrupted chat was not moved: %v", err)
	}
	if _, err := os.Stat(filepath.Join(chatsDir, "bad.json")); !os.IsNotExist(err) {
		t.Fatal("corrupted chat is still in the chats directory")
	}
}
