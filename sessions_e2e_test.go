//go:build e2e

package main

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func e2eEnv(t *testing.T, key string) string {
	t.Helper()
	v := os.Getenv(key)
	if v == "" {
		t.Skipf("%s not set", key)
	}
	return v
}

func setupE2E(t *testing.T) (*Store, *SessionManager) {
	t.Helper()
	dataDir := filepath.Join(".clean", "e2e-data")
	if err := os.MkdirAll(dataDir, 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("CONDUIT_DATA_DIR", dataDir)
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	mgr := NewSessionManager(store)
	var events []string
	mgr.emit = func(name string, args ...interface{}) {
		events = append(events, name)
	}
	t.Cleanup(func() {
		for _, s := range mgr.ListSessions() {
			mgr.Disconnect(s.ID)
		}
	})
	return store, mgr
}

func TestE2EPasswordSession(t *testing.T) {
	host, user, pass := e2eEnv(t, "CONDUIT_E2E_HOST"), e2eEnv(t, "CONDUIT_E2E_USER"), e2eEnv(t, "CONDUIT_E2E_PASSWORD")
	store, mgr := setupE2E(t)
	h, err := store.SaveHost(Host{
		Name: "e2e", Address: host, Port: e2ePort(t), User: user,
		AuthMethod: "password", Password: pass,
	})
	if err != nil {
		t.Fatal(err)
	}
	id, err := mgr.Connect(h.ID, 120, 32)
	if err != nil {
		t.Fatalf("connect: %v", err)
	}
	ctx := context.Background()

	res, err := mgr.runInSession(ctx, id, "echo hi; uname -a", 30)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "done" {
		t.Fatalf("status %q output %q", res.Status, res.Output)
	}
	if !strings.Contains(res.Output, "hi") {
		t.Fatalf("output missing 'hi': %q", res.Output)
	}

	res, err = mgr.runInSession(ctx, id, "sleep 3; echo done-marker", 30)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "done" || !strings.Contains(res.Output, "done-marker") {
		t.Fatalf("sleep status %q output %q", res.Status, res.Output)
	}

	res, err = mgr.runInSession(ctx, id, `read v`, 30)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "waiting_for_input_or_still_running" {
		t.Fatalf("read status %q", res.Status)
	}
	if err := mgr.sendKeys(id, "y<Enter>"); err != nil {
		t.Fatal(err)
	}
	time.Sleep(500 * time.Millisecond)
	res, err = mgr.runInSession(ctx, id, "echo val=$v", 30)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "done" || !strings.Contains(res.Output, "val=y") {
		t.Fatalf("post-read status %q output %q", res.Status, res.Output)
	}

	kh, err := os.ReadFile(knownHostsPath())
	if err != nil {
		t.Fatalf("known_hosts: %v", err)
	}
	if !strings.Contains(string(kh), host) {
		t.Fatalf("known_hosts missing host: %q", string(kh))
	}

	if _, err := mgr.readScreen(ctx, id, 10); err == nil || !strings.Contains(err.Error(), "terminal view not available") {
		t.Fatalf("readScreen without frontend: %v", err)
	}
}

func TestE2EKeyAuth(t *testing.T) {
	host, user := e2eEnv(t, "CONDUIT_E2E_HOST"), e2eEnv(t, "CONDUIT_E2E_USER")
	keyPath := e2eEnv(t, "CONDUIT_E2E_KEY")
	store, mgr := setupE2E(t)
	h, err := store.SaveHost(Host{
		Name: "e2e-key", Address: host, Port: e2ePort(t), User: user,
		AuthMethod: "key", KeyPath: keyPath,
	})
	if err != nil {
		t.Fatal(err)
	}
	id, err := mgr.Connect(h.ID, 120, 32)
	if err != nil {
		t.Fatalf("key connect: %v", err)
	}
	res, err := mgr.runInSession(context.Background(), id, "echo keyauth-ok", 30)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "done" || !strings.Contains(res.Output, "keyauth-ok") {
		t.Fatalf("key status %q output %q", res.Status, res.Output)
	}
}

func TestE2EQuickConnect(t *testing.T) {
	host, user, pass := e2eEnv(t, "CONDUIT_E2E_HOST"), e2eEnv(t, "CONDUIT_E2E_USER"), e2eEnv(t, "CONDUIT_E2E_PASSWORD")
	_, mgr := setupE2E(t)
	target := user + "@" + host + ":" + e2eEnv(t, "CONDUIT_E2E_PORT")
	id, err := mgr.QuickConnect(target, pass, 120, 32)
	if err != nil {
		t.Fatalf("quick connect: %v", err)
	}
	res, err := mgr.runInSession(context.Background(), id, "echo qc-ok", 30)
	if err != nil {
		t.Fatal(err)
	}
	if res.Status != "done" || !strings.Contains(res.Output, "qc-ok") {
		t.Fatalf("qc status %q output %q", res.Status, res.Output)
	}
}

func e2ePort(t *testing.T) int {
	t.Helper()
	p, err := strconv.Atoi(e2eEnv(t, "CONDUIT_E2E_PORT"))
	if err != nil {
		t.Fatalf("bad port: %v", err)
	}
	return p
}
