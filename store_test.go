package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

const testSSHConfig = `
# comment line
Host dev
    HostName dev.example.com
    User alice
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host prod web.example.com
    HostName 203.0.113.10
    User deploy

Host *.internal
    User ignored

Host bastion
    ProxyJump none

Match user bob
    HostName should-not-appear
`

func TestParseSSHConfig(t *testing.T) {
	home := t.TempDir()
	hosts := parseSSHConfig(strings.NewReader(testSSHConfig), home)
	if len(hosts) != 3 {
		t.Fatalf("got %d hosts: %+v", len(hosts), hosts)
	}
	byName := map[string]int{}
	for i, h := range hosts {
		byName[h.Name] = i
	}
	dev := hosts[byName["dev"]]
	if dev.Address != "dev.example.com" || dev.User != "alice" || dev.Port != 2222 {
		t.Fatalf("dev parsed wrong: %+v", dev)
	}
	wantKey := filepath.Join(home, ".ssh", "id_ed25519")
	if dev.KeyPath != wantKey || dev.AuthMethod != "key" {
		t.Fatalf("dev key wrong: %+v", dev)
	}
	prod := hosts[byName["prod"]]
	if prod.Address != "203.0.113.10" || prod.User != "deploy" || prod.Port != 22 {
		t.Fatalf("prod parsed wrong: %+v", prod)
	}
	bastion := hosts[byName["bastion"]]
	if bastion.Address != "bastion" || bastion.User == "" {
		t.Fatalf("bastion parsed wrong: %+v", bastion)
	}
}

func TestImportSSHConfigDedup(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	added, err := store.ImportSSHConfig(strings.NewReader(testSSHConfig), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(added) != 3 {
		t.Fatalf("added %d", len(added))
	}
	again, err := store.ImportSSHConfig(strings.NewReader(testSSHConfig), t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(again) != 0 {
		t.Fatalf("second import added %d", len(again))
	}
	if n := len(store.ListHosts()); n != 3 {
		t.Fatalf("hosts %d", n)
	}
	raw, _ := os.ReadFile(filepath.Join(dir, "conduit.json"))
	if !strings.Contains(string(raw), "dev.example.com") {
		t.Fatal("conduit.json missing host")
	}
}

func TestStoreCorruptFile(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	path := filepath.Join(dir, "conduit.json")
	bad := []byte("{ this is not json")
	if err := os.WriteFile(path, bad, 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewStore(); err == nil || !strings.Contains(err.Error(), "corrupted") {
		t.Fatalf("expected corruption error, got %v", err)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != string(bad) {
		t.Fatal("conduit.json was modified")
	}
}

func TestStoreMergePartialSettings(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	path := filepath.Join(dir, "conduit.json")
	raw := `{"hosts":[{"id":"h1","name":"keep","address":"example.com","port":22,"user":"u","authMethod":"agent"}],"settings":{"fontSize":16,"ai":{"maxSteps":5}}}`
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	st := store.GetSettings()
	if st.FontSize != 16 || st.AI.MaxSteps != 5 {
		t.Fatalf("saved values lost: %+v", st)
	}
	def := defaultSettings()
	if st.FontFamily != def.FontFamily || st.ThemeID != def.ThemeID || st.LineHeight != def.LineHeight ||
		st.UIScale != def.UIScale || st.AgentSide != def.AgentSide || st.Scrollback != def.Scrollback ||
		st.SidebarWidth != def.SidebarWidth || st.AgentWidth != def.AgentWidth || st.CursorStyle != def.CursorStyle {
		t.Fatalf("defaults not merged: %+v", st)
	}
	if !st.SidebarVisible || !st.AgentVisible || !st.AI.ApproveCommands {
		t.Fatalf("bool defaults not applied for missing keys: %+v", st)
	}
	if n := len(store.ListHosts()); n != 1 {
		t.Fatalf("hosts lost: %d", n)
	}
}
