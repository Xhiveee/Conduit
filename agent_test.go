package main

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

type recordedEvent struct {
	name string
	args []interface{}
}

func fakeLLM(t *testing.T, respond func(call int, req []byte) string) (*httptest.Server, func() []string) {
	t.Helper()
	var mu sync.Mutex
	var bodies [][]byte
	calls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		mu.Lock()
		bodies = append(bodies, raw)
		call := calls
		calls++
		mu.Unlock()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(respond(call, raw)))
	}))
	t.Cleanup(srv.Close)
	return srv, func() []string {
		mu.Lock()
		defer mu.Unlock()
		out := make([]string, len(bodies))
		for i, b := range bodies {
			out[i] = string(b)
		}
		return out
	}
}

func llmToolCallResp(id, name, args string) string {
	return fmt.Sprintf(`{"choices":[{"index":0,"message":{"role":"assistant","content":"","tool_calls":[{"id":%q,"type":"function","function":{"name":%q,"arguments":%q}}]},"finish_reason":"tool_calls"}]}`, id, name, args)
}

func llmTextResp(text string) string {
	return fmt.Sprintf(`{"choices":[{"index":0,"message":{"role":"assistant","content":%q},"finish_reason":"stop"}]}`, text)
}

func agentAppWith(store *Store, mgr *SessionManager) (*App, func() []recordedEvent) {
	chats, err := NewChatStore()
	if err != nil {
		panic(err)
	}
	app := NewApp(store, chats)
	var mu sync.Mutex
	var events []recordedEvent
	app.emitFn = func(name string, args ...interface{}) {
		mu.Lock()
		events = append(events, recordedEvent{name: name, args: args})
		mu.Unlock()
	}
	app.chats.setEmit(app.emitFn)
	app.sessions = mgr
	if mgr != nil {
		mgr.emit = app.emitFn
	}
	app.agent = NewAgent(app)
	return app, func() []recordedEvent {
		mu.Lock()
		defer mu.Unlock()
		out := make([]recordedEvent, len(events))
		copy(out, events)
		return out
	}
}

func waitFor(t *testing.T, what string, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(25 * time.Millisecond)
	}
	t.Fatalf("timed out waiting for %s", what)
}

func agentBusyFalse(events func() []recordedEvent) bool {
	for _, e := range events() {
		if e.name == "agent:busy" && len(e.args) > 1 {
			if b, ok := e.args[1].(bool); ok && !b {
				return true
			}
		}
	}
	return false
}

func toolResults(r chatRequest) []string {
	var out []string
	for _, m := range r.Messages {
		if m.Role == "tool" {
			out = append(out, m.Content)
		}
	}
	return out
}

func configureAITestStore(t *testing.T, store *Store, baseURL string, approve bool) {
	t.Helper()
	st := store.GetSettings()
	st.AI.BaseURL = baseURL
	st.AI.Model = "test-model"
	st.AI.APIKey = "test-key"
	st.AI.ApproveCommands = approve
	if err := store.SaveSettings(st); err != nil {
		t.Fatal(err)
	}
}

func TestAgentToolLoop(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	srv, requests := fakeLLM(t, func(call int, req []byte) string {
		switch call {
		case 0:
			return llmToolCallResp("call_hosts", "list_hosts", "{}")
		case 1:
			return llmToolCallResp("call_settings", "update_settings", `{"settings":{"fontSize":16}}`)
		default:
			return llmTextResp("all done")
		}
	})
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.SaveHost(Host{Name: "tool-host", Address: "h.example.com", Port: 22, User: "u", AuthMethod: "agent"}); err != nil {
		t.Fatal(err)
	}
	configureAITestStore(t, store, srv.URL, false)
	app, events := agentAppWith(store, NewSessionManager(store))
	if err := app.AgentSend("", "check things", ""); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "agent to finish", func() bool { return agentBusyFalse(events) })
	reqs := requests()
	if len(reqs) != 3 {
		t.Fatalf("expected 3 LLM calls, got %d", len(reqs))
	}
	var second, third chatRequest
	if err := json.Unmarshal([]byte(reqs[1]), &second); err != nil {
		t.Fatal(err)
	}
	if err := json.Unmarshal([]byte(reqs[2]), &third); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(toolResults(second), "\n"); !strings.Contains(got, "tool-host") {
		t.Fatalf("second request missing hosts result: %s", reqs[1])
	}
	if got := strings.Join(toolResults(third), "\n"); !strings.Contains(got, `"fontSize":16`) {
		t.Fatalf("third request missing settings result: %s", reqs[2])
	}
	sawAssistant := false
	for _, e := range events() {
		if e.name == "agent:message" && len(e.args) > 1 {
			if m, ok := e.args[1].(ChatLogEntry); ok && m.Kind == "assistant" && m.Content == "all done" {
				sawAssistant = true
			}
		}
	}
	if !sawAssistant {
		t.Fatal("final assistant message not emitted")
	}
	if got := store.GetSettings().FontSize; got != 16 {
		t.Fatalf("fontSize not persisted: %d", got)
	}
}

func TestAgentApprovalReject(t *testing.T) {
	dir := t.TempDir()
	t.Setenv("CONDUIT_DATA_DIR", dir)
	var hostID string
	srv, requests := fakeLLM(t, func(call int, req []byte) string {
		switch call {
		case 0:
			return llmToolCallResp("call_del", "delete_host", fmt.Sprintf(`{"id":%q}`, hostID))
		default:
			return llmTextResp("rejected, moving on")
		}
	})
	store, err := NewStore()
	if err != nil {
		t.Fatal(err)
	}
	h, err := store.SaveHost(Host{Name: "del-me", Address: "h.example.com", Port: 22, User: "u", AuthMethod: "agent"})
	if err != nil {
		t.Fatal(err)
	}
	hostID = h.ID
	configureAITestStore(t, store, srv.URL, true)
	app, events := agentAppWith(store, NewSessionManager(store))
	if err := app.AgentSend("", "delete that host", ""); err != nil {
		t.Fatal(err)
	}
	waitFor(t, "pending approval", func() bool {
		for _, e := range events() {
			if e.name == "agent:tool" && len(e.args) > 1 {
				if ev, ok := e.args[1].(ChatLogEntry); ok && ev.CallID == "call_del" && ev.Status == "pending_approval" {
					return true
				}
			}
		}
		return false
	})
	if n := len(requests()); n != 1 {
		t.Fatalf("agent should be blocked before approval, got %d LLM requests", n)
	}
	app.AgentApprove("call_del", false)
	waitFor(t, "agent to finish", func() bool { return agentBusyFalse(events) })
	reqs := requests()
	if len(reqs) != 2 {
		t.Fatalf("expected 2 LLM calls, got %d", len(reqs))
	}
	var second chatRequest
	if err := json.Unmarshal([]byte(reqs[1]), &second); err != nil {
		t.Fatal(err)
	}
	if got := strings.Join(toolResults(second), "\n"); !strings.Contains(got, "user rejected") {
		t.Fatalf("tool result missing rejection: %s", reqs[1])
	}
	if _, ok := store.HostByID(hostID); !ok {
		t.Fatal("host was deleted despite rejection")
	}
	sawRejected := false
	for _, e := range events() {
		if e.name == "agent:tool" && len(e.args) > 1 {
			if ev, ok := e.args[1].(ChatLogEntry); ok && ev.CallID == "call_del" && ev.Status == "rejected" {
				sawRejected = true
			}
		}
	}
	if !sawRejected {
		t.Fatal("rejected tool event not emitted")
	}
}
