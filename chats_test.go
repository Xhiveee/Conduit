package main

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

func newTestChatStore(t *testing.T) *ChatStore {
	t.Helper()
	cs, err := NewChatStore()
	if err != nil {
		t.Fatal(err)
	}
	return cs
}

func TestChatStoreCRUD(t *testing.T) {
	t.Setenv("CONDUIT_DATA_DIR", t.TempDir())
	cs := newTestChatStore(t)
	s, err := cs.Create("host-1")
	if err != nil {
		t.Fatal(err)
	}
	if s.ID == "" || s.HostID != "host-1" || s.CreatedAt == 0 {
		t.Fatalf("bad summary: %+v", s)
	}
	if _, err := cs.Rename(s.ID, "my chat"); err != nil {
		t.Fatal(err)
	}
	if _, err := cs.SetGroup(s.ID, "ops"); err != nil {
		t.Fatal(err)
	}
	if _, err := cs.Attach(s.ID, "host-2"); err != nil {
		t.Fatal(err)
	}
	if _, err := cs.Archive(s.ID, true); err != nil {
		t.Fatal(err)
	}
	got, ok := cs.Get(s.ID)
	if !ok {
		t.Fatal("chat missing")
	}
	if got.Title != "my chat" || got.Group != "ops" || got.HostID != "host-2" || !got.Archived {
		t.Fatalf("bad chat: %+v", got.ChatSummary)
	}
	list := cs.List()
	if len(list) != 1 || !list[0].Archived {
		t.Fatalf("bad list: %+v", list)
	}
	if err := cs.Delete(s.ID); err != nil {
		t.Fatal(err)
	}
	if _, ok := cs.Get(s.ID); ok {
		t.Fatal("chat still present after delete")
	}
	if _, err := os.Stat(filepath.Join(dataDir(), "chats", s.ID+".json")); !os.IsNotExist(err) {
		t.Fatal("chat file not removed")
	}
}

func TestChatStorePersistence(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	cs := newTestChatStore(t)
	s, err := cs.Create("")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cs.Rename(s.ID, "persisted"); err != nil {
		t.Fatal(err)
	}
	cs2, err := NewChatStore()
	if err != nil {
		t.Fatal(err)
	}
	got, ok := cs2.Get(s.ID)
	if !ok || got.Title != "persisted" {
		t.Fatalf("chat not reloaded: %+v", got)
	}
}

func TestChatStoreBusyResetOnLoad(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	cs := newTestChatStore(t)
	s, err := cs.Create("")
	if err != nil {
		t.Fatal(err)
	}
	cs.setBusy(s.ID, true)
	if err := cs.persist(cs.chats[s.ID]); err != nil {
		t.Fatal(err)
	}
	cs2, err := NewChatStore()
	if err != nil {
		t.Fatal(err)
	}
	got, ok := cs2.Get(s.ID)
	if !ok || got.Busy {
		t.Fatalf("busy not reset on load: %+v", got)
	}
}

func TestChatStoreCorrupted(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	cs := newTestChatStore(t)
	if err := os.MkdirAll(filepath.Join(dir, "chats"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "chats", "bad.json"), []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	_ = cs
	if _, err := NewChatStore(); err == nil || !strings.Contains(err.Error(), "corrupted") {
		t.Fatalf("expected corruption error, got %v", err)
	}
}

func TestChatStoreTitleEmit(t *testing.T) {
	t.Setenv("CONDUIT_DATA_DIR", t.TempDir())
	cs := newTestChatStore(t)
	var mu sync.Mutex
	var events []recordedEvent
	cs.setEmit(func(name string, args ...interface{}) {
		mu.Lock()
		events = append(events, recordedEvent{name: name, args: args})
		mu.Unlock()
	})
	s, err := cs.Create("")
	if err != nil {
		t.Fatal(err)
	}
	if err := cs.setTitleIfEmpty(s.ID, "first line title"); err != nil {
		t.Fatal(err)
	}
	var updated []ChatSummary
	for _, e := range events {
		if e.name == "chat:updated" && len(e.args) > 0 {
			if sum, ok := e.args[0].(ChatSummary); ok {
				updated = append(updated, sum)
			}
		}
	}
	if len(updated) != 2 {
		t.Fatalf("expected create + title events, got %d", len(updated))
	}
	if updated[1].Title != "first line title" || updated[1].ID != s.ID {
		t.Fatalf("bad title event: %+v", updated[1])
	}
	if err := cs.setTitleIfEmpty(s.ID, "second title"); err != nil {
		t.Fatal(err)
	}
	count := 0
	for _, e := range events {
		if e.name == "chat:updated" {
			count++
		}
	}
	if count != 2 {
		t.Fatalf("title re-emit on non-empty title: %d events", count)
	}
}

func TestChatStoreDetachHost(t *testing.T) {
	t.Setenv("CONDUIT_DATA_DIR", t.TempDir())
	cs := newTestChatStore(t)
	s1, _ := cs.Create("h1")
	s2, _ := cs.Create("h2")
	cs.DetachHost("h1")
	g1, _ := cs.GetSummary(s1.ID)
	g2, _ := cs.GetSummary(s2.ID)
	if g1.HostID != "" {
		t.Fatalf("chat still attached: %+v", g1)
	}
	if g2.HostID != "h2" {
		t.Fatalf("wrong chat detached: %+v", g2)
	}
}

func llmUsageResp(text string, prompt, completion, total int) string {
	return fmt.Sprintf(`{"choices":[{"index":0,"message":{"role":"assistant","content":%q},"finish_reason":"stop"}],"usage":{"prompt_tokens":%d,"completion_tokens":%d,"total_tokens":%d}}`, text, prompt, completion, total)
}

func TestAgentUsageAndLog(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	srv, _ := fakeLLM(t, func(call int, req []byte) string {
		if call == 0 {
			return llmUsageResp("first answer", 100, 10, 110)
		}
		return llmUsageResp("second answer", 200, 20, 220)
	})
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	configureAITestStore(t, store, srv.URL, false)
	app, events := agentAppWith(store, NewSessionManager(store))
	chat, err := app.chats.Create("")
	if err != nil {
		t.Fatal(err)
	}
	if err := app.AgentSend(chat.ID, "hello there\nsecond line", ""); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "first run", func() bool { return agentBusyFalse(events) })
	if err := app.AgentSend(chat.ID, "again", ""); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "second run done", func() bool {
		c, ok := app.chats.Get(chat.ID)
		return ok && len(c.Log) >= 4 && !c.Busy
	})
	sum, ok := app.chats.GetSummary(chat.ID)
	if !ok {
		t.Fatal("chat missing")
	}
	if sum.Usage.PromptTokens != 300 || sum.Usage.CompletionTokens != 30 || sum.Usage.TotalTokens != 330 {
		t.Fatalf("bad usage: %+v", sum.Usage)
	}
	if sum.Usage.LastPromptTokens != 200 {
		t.Fatalf("bad last prompt tokens: %+v", sum.Usage)
	}
	if sum.Title != "hello there" {
		t.Fatalf("bad auto title: %q", sum.Title)
	}
	full, _ := app.chats.Get(chat.ID)
	kinds := []string{}
	for _, e := range full.Log {
		kinds = append(kinds, e.Kind)
	}
	want := []string{"user", "assistant", "user", "assistant"}
	if fmt.Sprint(kinds) != fmt.Sprint(want) {
		t.Fatalf("bad log order: %v", kinds)
	}
	if len(full.Messages) == 0 {
		t.Fatal("messages not persisted")
	}
}

func TestAgentBusyRejectAndConcurrent(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	release := make(chan struct{})
	var once sync.Once
	srv, _ := fakeLLM(t, func(call int, req []byte) string {
		once.Do(func() { go func() { time.Sleep(300 * time.Millisecond); close(release) }() })
		<-release
		if strings.Contains(string(req), "alpha") {
			return llmTextResp("answer alpha")
		}
		return llmTextResp("answer beta")
	})
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	configureAITestStore(t, store, srv.URL, false)
	app, events := agentAppWith(store, NewSessionManager(store))
	c1, _ := app.chats.Create("")
	c2, _ := app.chats.Create("")
	if err := app.AgentSend(c1.ID, "alpha task", ""); err != nil {
		t.Fatal(err)
	}
	if err := app.AgentSend(c1.ID, "second", ""); err == nil {
		t.Fatal("expected busy error for same chat")
	}
	if err := app.AgentSend(c2.ID, "beta task", ""); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		done := 0
		for _, id := range []string{c1.ID, c2.ID} {
			if s, ok := app.chats.GetSummary(id); ok && !s.Busy {
				done++
			}
		}
		if done == 2 {
			break
		}
		time.Sleep(25 * time.Millisecond)
	}
	for _, e := range events() {
		if e.name == "agent:message" && len(e.args) > 1 {
			cid, _ := e.args[0].(string)
			m, _ := e.args[1].(ChatLogEntry)
			if m.Kind == "assistant" {
				if cid == c1.ID && !strings.Contains(m.Content, "alpha") {
					t.Fatalf("chat1 got wrong content: %q", m.Content)
				}
				if cid == c2.ID && !strings.Contains(m.Content, "beta") {
					t.Fatalf("chat2 got wrong content: %q", m.Content)
				}
			}
		}
	}
	if err := app.chats.Delete(c1.ID); err != nil {
		t.Fatal(err)
	}
	var raw []byte
	raw, _ = os.ReadFile(filepath.Join(dir, "chats", c1.ID+".json"))
	if len(raw) != 0 {
		t.Fatal("deleted chat file still exists")
	}
}
