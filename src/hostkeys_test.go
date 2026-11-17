package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/knownhosts"
)

type testAddr struct {
	addr string
}

func (a testAddr) Network() string { return "tcp" }

func (a testAddr) String() string { return a.addr }

func testHostKey(t *testing.T) ssh.PublicKey {
	t.Helper()
	_, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		t.Fatalf("signer: %v", err)
	}
	return signer.PublicKey()
}

func hasLine(text, want string) bool {
	for _, line := range strings.Split(text, "\n") {
		if line == want {
			return true
		}
	}
	return false
}

func TestRewriteKnownHostsReplacesHostEntry(t *testing.T) {
	data := []byte("# managed by Conduit\nexample.com ssh-ed25519 AAAABOLD\nexample.org ssh-ed25519 AAAAC\n")
	got := string(rewriteKnownHosts(data, "example.com", nil, nil, "example.com ssh-ed25519 AAAANEW"))
	want := "# managed by Conduit\nexample.org ssh-ed25519 AAAAC\nexample.com ssh-ed25519 AAAANEW\n"
	if got != want {
		t.Fatalf("unexpected rewrite:\n got: %q\nwant: %q", got, want)
	}
}

func TestRewriteKnownHostsAppendsToEmptyFile(t *testing.T) {
	got := string(rewriteKnownHosts(nil, "host", nil, nil, "host ssh-ed25519 AAAA"))
	want := "host ssh-ed25519 AAAA\n"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestRewriteKnownHostsKeepsMultiHostLine(t *testing.T) {
	data := []byte("a.example.com,b.example.com ssh-ed25519 AAAA\n")
	got := string(rewriteKnownHosts(data, "a.example.com", nil, nil, "a.example.com ssh-ed25519 BBBB"))
	want := "b.example.com ssh-ed25519 AAAA\na.example.com ssh-ed25519 BBBB\n"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestRewriteKnownHostsMatchesPortAndCase(t *testing.T) {
	data := []byte("[Example.com]:2222 ssh-ed25519 AAAA\nother:22 ssh-ed25519 CCCC\n")
	got := string(rewriteKnownHosts(data, "example.com:2222", nil, nil, "[example.com]:2222 ssh-ed25519 BBBB"))
	want := "other:22 ssh-ed25519 CCCC\n[example.com]:2222 ssh-ed25519 BBBB\n"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestRewriteKnownHostsOnlyRemovesExactHost(t *testing.T) {
	data := []byte("example.com ssh-ed25519 AAAA\nbadexample.com ssh-ed25519 CCCC\n")
	got := string(rewriteKnownHosts(data, "example.com", nil, nil, "example.com ssh-ed25519 BBBB"))
	want := "badexample.com ssh-ed25519 CCCC\nexample.com ssh-ed25519 BBBB\n"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}

func TestRewriteKnownHostsDropsHashedConflictByKey(t *testing.T) {
	data := []byte("|1|abc=|1|def= ssh-ed25519 AAAAOLD\n|1|xyz=|1|uvw= ssh-ed25519 KEEP\n")
	lines := map[int]struct{}{0: {}}
	got := string(rewriteKnownHosts(data, "example.com", lines, []string{"ssh-ed25519 AAAAOLD"}, "example.com ssh-ed25519 BBBB"))
	if strings.Contains(got, "AAAAOLD") {
		t.Fatalf("conflicting hashed line was kept: %q", got)
	}
	if !strings.Contains(got, "ssh-ed25519 KEEP") {
		t.Fatalf("unrelated hashed line was dropped: %q", got)
	}
	if !strings.HasSuffix(got, "example.com ssh-ed25519 BBBB\n") {
		t.Fatalf("new line was not appended last: %q", got)
	}
}

func TestRewriteKnownHostsKeepsUnrelatedConflictLine(t *testing.T) {
	data := []byte("|1|abc=|1|def= ssh-ed25519 OTHERKEY\n")
	lines := map[int]struct{}{0: {}}
	got := string(rewriteKnownHosts(data, "example.com", lines, []string{"ssh-ed25519 AAAAOLD"}, "example.com ssh-ed25519 BBBB"))
	if !strings.Contains(got, "OTHERKEY") {
		t.Fatalf("line without the old key was removed: %q", got)
	}
}

func TestHostKeyDecisionResolvesWaiter(t *testing.T) {
	m := &SessionManager{}
	requestID, reply := m.addHostKeyWaiter()
	m.resolveHostKeyDecision(requestID, true)
	select {
	case trust := <-reply:
		if !trust {
			t.Fatal("decision was not delivered")
		}
	case <-time.After(time.Second):
		t.Fatal("decision did not resolve")
	}
	m.removeHostKeyWaiter(requestID)
	m.resolveHostKeyDecision(requestID, false)
}

func TestApplyHostKeyUpdateRewritesFile(t *testing.T) {
	t.Setenv("CONDUIT_DATA_DIR", t.TempDir())
	oldKey := testHostKey(t)
	newKey := testHostKey(t)
	path := knownHostsPath()
	data := knownhosts.Line([]string{"example.com"}, oldKey) + "\n# keep\n" +
		knownhosts.Line([]string{"other.example.com"}, oldKey) + "\n"
	if err := os.WriteFile(path, []byte(data), 0o600); err != nil {
		t.Fatalf("write known_hosts: %v", err)
	}
	m := NewSessionManager(nil)
	requestID := m.rememberHostKeyUpdate(&hostKeyUpdate{
		hostname: "example.com:22",
		key:      newKey,
		oldKeys:  []string{serializedKey(oldKey)},
		lines:    map[int]struct{}{0: {}},
		at:       time.Now(),
	})
	if err := m.applyHostKeyUpdate(requestID); err != nil {
		t.Fatalf("apply update: %v", err)
	}
	out, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read known_hosts: %v", err)
	}
	text := string(out)
	if hasLine(text, knownhosts.Line([]string{"example.com"}, oldKey)) {
		t.Fatalf("old key entry was kept: %q", text)
	}
	if !hasLine(text, knownhosts.Line([]string{"example.com"}, newKey)) {
		t.Fatalf("new key entry missing: %q", text)
	}
	if !hasLine(text, knownhosts.Line([]string{"other.example.com"}, oldKey)) {
		t.Fatalf("unrelated entry was removed: %q", text)
	}
	if !strings.Contains(text, "# keep") {
		t.Fatalf("comment was removed: %q", text)
	}
	if again := m.applyHostKeyUpdate(requestID); again == nil {
		t.Fatal("second update of the same request should fail")
	}
}

func newHostKeyTestManager() (*SessionManager, chan HostKeyRequest) {
	m := NewSessionManager(nil)
	events := make(chan HostKeyRequest, 4)
	m.emit = func(name string, args ...interface{}) {
		if name != "session:hostkey" || len(args) != 1 {
			return
		}
		if req, ok := args[0].(HostKeyRequest); ok {
			events <- req
		}
	}
	return m, events
}

func waitHostKeyEvent(t *testing.T, events chan HostKeyRequest) HostKeyRequest {
	t.Helper()
	select {
	case req := <-events:
		return req
	case <-time.After(2 * time.Second):
		t.Fatal("host key event was not emitted")
		return HostKeyRequest{}
	}
}

func waitCallback(t *testing.T, done chan error) error {
	t.Helper()
	select {
	case err := <-done:
		return err
	case <-time.After(2 * time.Second):
		t.Fatal("host key callback did not resume")
		return nil
	}
}

func TestHostKeyCallbackAsksBeforeTrustingNewKey(t *testing.T) {
	t.Setenv("CONDUIT_DATA_DIR", t.TempDir())
	m, events := newHostKeyTestManager()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cb, err := m.hostKeyCallback(ctx)
	if err != nil {
		t.Fatalf("callback: %v", err)
	}
	key := testHostKey(t)
	done := make(chan error, 1)
	go func() { done <- cb("example.com:22", testAddr{"192.0.2.1:22"}, key) }()
	req := waitHostKeyEvent(t, events)
	if req.Kind != "new" || req.Hostname != "example.com:22" || req.Fingerprint != ssh.FingerprintSHA256(key) {
		t.Fatalf("unexpected prompt: %+v", req)
	}
	if data, err := os.ReadFile(knownHostsPath()); err != nil || strings.TrimSpace(string(data)) != "" {
		t.Fatalf("known_hosts written before the decision: %q (%v)", data, err)
	}
	app := &App{sessions: m}
	app.SessionHostKeyDecision(req.RequestID, true)
	if err := waitCallback(t, done); err != nil {
		t.Fatalf("trusted key rejected: %v", err)
	}
	out, err := os.ReadFile(knownHostsPath())
	if err != nil {
		t.Fatalf("read known_hosts: %v", err)
	}
	if !hasLine(string(out), knownhosts.Line([]string{"example.com:22"}, key)) {
		t.Fatalf("trusted key not saved: %q", out)
	}
	reloaded, err := m.hostKeyCallback(ctx)
	if err != nil {
		t.Fatalf("reload callback: %v", err)
	}
	if err := reloaded("example.com:22", testAddr{"192.0.2.1:22"}, key); err != nil {
		t.Fatalf("saved key rejected: %v", err)
	}
}

func TestHostKeyCallbackRejectsNewKey(t *testing.T) {
	t.Setenv("CONDUIT_DATA_DIR", t.TempDir())
	m, events := newHostKeyTestManager()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cb, err := m.hostKeyCallback(ctx)
	if err != nil {
		t.Fatalf("callback: %v", err)
	}
	done := make(chan error, 1)
	go func() { done <- cb("example.com:22", testAddr{"192.0.2.1:22"}, testHostKey(t)) }()
	req := waitHostKeyEvent(t, events)
	app := &App{sessions: m}
	app.SessionHostKeyDecision(req.RequestID, false)
	err = waitCallback(t, done)
	if err == nil || !strings.Contains(err.Error(), "host key rejected by user") {
		t.Fatalf("unexpected callback error: %v", err)
	}
	if data, _ := os.ReadFile(knownHostsPath()); strings.TrimSpace(string(data)) != "" {
		t.Fatalf("rejected key was saved: %q", data)
	}
}

func TestHostKeyCallbackReportsChangedKey(t *testing.T) {
	t.Setenv("CONDUIT_DATA_DIR", t.TempDir())
	oldKey := testHostKey(t)
	newKey := testHostKey(t)
	if err := os.WriteFile(knownHostsPath(), []byte(knownhosts.Line([]string{"example.com"}, oldKey)+"\n"), 0o600); err != nil {
		t.Fatalf("write known_hosts: %v", err)
	}
	m, events := newHostKeyTestManager()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	cb, err := m.hostKeyCallback(ctx)
	if err != nil {
		t.Fatalf("callback: %v", err)
	}
	err = cb("example.com:22", testAddr{"192.0.2.1:22"}, newKey)
	if err == nil || !strings.Contains(err.Error(), "host key mismatch for") {
		t.Fatalf("unexpected callback error: %v", err)
	}
	req := waitHostKeyEvent(t, events)
	if req.Kind != "changed" || req.Fingerprint != ssh.FingerprintSHA256(newKey) ||
		req.OldFingerprint != ssh.FingerprintSHA256(oldKey) {
		t.Fatalf("unexpected prompt: %+v", req)
	}
	app := &App{sessions: m}
	if err := app.SessionHostKeyUpdate(req.RequestID); err != nil {
		t.Fatalf("update: %v", err)
	}
	reloaded, err := m.hostKeyCallback(ctx)
	if err != nil {
		t.Fatalf("reload callback: %v", err)
	}
	if err := reloaded("example.com:22", testAddr{"192.0.2.1:22"}, newKey); err != nil {
		t.Fatalf("updated key rejected: %v", err)
	}
	out, err := os.ReadFile(knownHostsPath())
	if err != nil {
		t.Fatalf("read known_hosts: %v", err)
	}
	if hasLine(string(out), knownhosts.Line([]string{"example.com"}, oldKey)) {
		t.Fatalf("old key entry was kept: %q", out)
	}
	if !hasLine(string(out), knownhosts.Line([]string{"example.com"}, newKey)) {
		t.Fatalf("new key entry missing: %q", out)
	}
}

func TestHostKeyCallbackStopsOnContextCancel(t *testing.T) {
	t.Setenv("CONDUIT_DATA_DIR", t.TempDir())
	m, events := newHostKeyTestManager()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	cb, err := m.hostKeyCallback(ctx)
	if err != nil {
		t.Fatalf("callback: %v", err)
	}
	err = cb("example.com:22", testAddr{"192.0.2.1:22"}, testHostKey(t))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("unexpected callback error: %v", err)
	}
	waitHostKeyEvent(t, events)
	m.hostKeyMu.Lock()
	waiting := len(m.hostKeyWait)
	m.hostKeyMu.Unlock()
	if waiting != 0 {
		t.Fatalf("waiter was not released: %d", waiting)
	}
}
