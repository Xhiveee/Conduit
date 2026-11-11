package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
)

type agentMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type agentToolEvent struct {
	CallID string `json:"callId"`
	Name   string `json:"name"`
	Args   string `json:"args"`
	Status string `json:"status"`
	Result string `json:"result"`
}

type Agent struct {
	app      *App
	mu       sync.Mutex
	messages []chatMessage
	cancel   context.CancelFunc
	running  bool
	gen      int
	pending  map[string]chan bool
}

func NewAgent(app *App) *Agent {
	return &Agent{app: app, pending: make(map[string]chan bool)}
}

const agentSystemPrompt = `You operate Conduit, a desktop SSH client. You can run commands inside the user's live terminal sessions - the user sees everything you type in real time and can also type in the same session at any moment.
Prefer non-interactive command flags (-y, --no-pager, | cat, DEBIAN_FRONTEND=noninteractive for apt) so commands finish without prompting. When a command needs input, use send_keys to answer prompts.
Never run destructive commands (recursive deletes, dropping databases, killing system processes, overwriting disks) unless the user explicitly asked for it.
When run_command returns status "waiting_for_input_or_still_running", use read_screen to see the terminal and decide whether to send_keys, wait, or try a different approach.
Use read_screen to inspect a session before acting on it. Use focus_session to bring a session tab to the front for the user.
Answer in the user's language. Be concise.`

var agentTools = []llmTool{
	newLLMTool("list_hosts", "List all saved SSH hosts.", `{"type":"object","properties":{}}`),
	newLLMTool("add_host", "Add a new SSH host.", `{"type":"object","properties":{"name":{"type":"string"},"group":{"type":"string"},"address":{"type":"string"},"port":{"type":"integer"},"user":{"type":"string"},"auth_method":{"type":"string","enum":["key","password","agent"]},"key_path":{"type":"string"},"key_passphrase":{"type":"string"},"password":{"type":"string"},"color":{"type":"string"},"notes":{"type":"string"}},"required":["address"]}`),
	newLLMTool("update_host", "Update fields of an existing host. Only provided fields change.", `{"type":"object","properties":{"id":{"type":"string"},"name":{"type":"string"},"group":{"type":"string"},"address":{"type":"string"},"port":{"type":"integer"},"user":{"type":"string"},"auth_method":{"type":"string","enum":["key","password","agent"]},"key_path":{"type":"string"},"key_passphrase":{"type":"string"},"password":{"type":"string"},"color":{"type":"string"},"notes":{"type":"string"}},"required":["id"]}`),
	newLLMTool("delete_host", "Delete a saved host by id.", `{"type":"object","properties":{"id":{"type":"string"}},"required":["id"]}`),
	newLLMTool("connect", "Open an SSH session to a saved host. Returns the new session id.", `{"type":"object","properties":{"host_id":{"type":"string"}},"required":["host_id"]}`),
	newLLMTool("quick_connect", "Open an SSH session to user@host[:port] without a saved host. Tries agent, default keys, then password if given.", `{"type":"object","properties":{"target":{"type":"string"},"password":{"type":"string"}},"required":["target"]}`),
	newLLMTool("list_sessions", "List open terminal sessions.", `{"type":"object","properties":{}}`),
	newLLMTool("run_command", "Type a command into a session's terminal and wait for it to finish. The user sees it live.", `{"type":"object","properties":{"session_id":{"type":"string"},"command":{"type":"string"},"timeout_sec":{"type":"integer"}},"required":["session_id","command"]}`),
	newLLMTool("send_keys", "Send keystrokes to a session. Tokens like <Enter> <Tab> <Esc> <Up> <Down> <C-c> <C-d> <Space> are supported.", `{"type":"object","properties":{"session_id":{"type":"string"},"keys":{"type":"string"}},"required":["session_id","keys"]}`),
	newLLMTool("read_screen", "Read the last lines of a session's terminal (stripped text).", `{"type":"object","properties":{"session_id":{"type":"string"},"lines":{"type":"integer"}},"required":["session_id"]}`),
	newLLMTool("disconnect", "Close a session.", `{"type":"object","properties":{"session_id":{"type":"string"}},"required":["session_id"]}`),
	newLLMTool("focus_session", "Bring a session's tab to the front.", `{"type":"object","properties":{"session_id":{"type":"string"}},"required":["session_id"]}`),
	newLLMTool("set_theme", "Switch the UI theme. Builtin ids: black, dark, graphite, nord, solarized-dark, light. Custom theme ids also work.", `{"type":"object","properties":{"theme_id":{"type":"string"}},"required":["theme_id"]}`),
	newLLMTool("update_settings", "Update UI settings live: fontSize, fontFamily, lineHeight, cursorStyle, uiScale, sidebarVisible, agentVisible, agentSide, themeId.", `{"type":"object","properties":{"settings":{"type":"object","properties":{"fontSize":{"type":"integer"},"fontFamily":{"type":"string"},"lineHeight":{"type":"number"},"cursorStyle":{"type":"string"},"uiScale":{"type":"number"},"sidebarVisible":{"type":"boolean"},"agentVisible":{"type":"boolean"},"agentSide":{"type":"string","enum":["left","right"]},"themeId":{"type":"string"}}}},"required":["settings"]}`),
	newLLMTool("list_keys", "List discovered SSH keys (files in ~/.ssh and agent keys).", `{"type":"object","properties":{}}`),
	newLLMTool("list_themes", "List available themes with id, name and builtin flag.", `{"type":"object","properties":{}}`),
}

func (a *Agent) send(text, activeSessionID string) error {
	a.mu.Lock()
	if a.running {
		a.mu.Unlock()
		return fmt.Errorf("agent is busy")
	}
	a.running = true
	cfg := a.app.store.GetSettings().AI
	userMsg := chatMessage{Role: "user", Content: text + a.contextSuffix(activeSessionID)}
	a.messages = append(a.messages, userMsg)
	gen := a.gen
	ctx, cancelFn := context.WithCancel(context.Background())
	a.cancel = cancelFn
	a.mu.Unlock()
	a.app.emit("agent:message", agentMessage{Role: "user", Content: text})
	a.app.emit("agent:busy", true)
	go a.run(ctx, cfg, gen)
	return nil
}

func (a *Agent) contextSuffix(activeSessionID string) string {
	sessions := a.app.sessions.ListSessions()
	var b strings.Builder
	b.WriteString("\n\n[Context: ")
	if activeSessionID != "" {
		for _, s := range sessions {
			if s.ID == activeSessionID {
				fmt.Fprintf(&b, "active session %s (%q)", s.ID, s.Title)
				break
			}
		}
		if !strings.Contains(b.String(), activeSessionID) {
			fmt.Fprintf(&b, "active session %s", activeSessionID)
		}
	} else {
		b.WriteString("no active session")
	}
	if len(sessions) > 0 {
		b.WriteString("; open sessions:")
		for _, s := range sessions {
			fmt.Fprintf(&b, " %s=%q(connected:%v)", s.ID, s.Title, s.Connected)
		}
	}
	b.WriteString("]")
	return b.String()
}

func (a *Agent) run(ctx context.Context, cfg AISettings, gen int) {
	messages := append([]chatMessage{{Role: "system", Content: agentSystemPrompt + instructionsSuffix(cfg.Instructions)}}, a.messagesSnapshot()...)
	maxSteps := cfg.MaxSteps
	if maxSteps <= 0 {
		maxSteps = 30
	}
	for step := 0; step < maxSteps; step++ {
		msg, err := chatCompletion(ctx, cfg, messages, agentTools)
		if err != nil {
			if ctx.Err() == nil {
				a.app.emit("agent:error", err.Error())
			}
			break
		}
		messages = append(messages, *msg)
		if len(msg.ToolCalls) == 0 {
			a.app.emit("agent:message", agentMessage{Role: "assistant", Content: msg.Content})
			break
		}
		if strings.TrimSpace(msg.Content) != "" {
			a.app.emit("agent:message", agentMessage{Role: "assistant", Content: msg.Content})
		}
		for _, call := range msg.ToolCalls {
			result := a.execTool(ctx, cfg, call)
			messages = append(messages, chatMessage{
				Role:       "tool",
				ToolCallID: call.ID,
				Name:       call.Function.Name,
				Content:    result,
			})
		}
	}
	a.mu.Lock()
	if a.gen == gen {
		a.messages = messages[1:]
		a.running = false
	}
	busy := a.running
	a.mu.Unlock()
	a.app.emit("agent:busy", busy)
}

func (a *Agent) messagesSnapshot() []chatMessage {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]chatMessage, len(a.messages))
	copy(out, a.messages)
	return out
}

func instructionsSuffix(inst string) string {
	if strings.TrimSpace(inst) == "" {
		return ""
	}
	return "\n\nAdditional instructions from the user:\n" + inst
}

func (a *Agent) stop() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.cancel != nil {
		a.cancel()
		a.cancel = nil
	}
}

func (a *Agent) reset() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.gen++
	a.messages = nil
	if a.cancel != nil {
		a.cancel()
		a.cancel = nil
	}
	a.running = false
}

func (a *Agent) approve(callID string, approved bool) {
	a.mu.Lock()
	ch, ok := a.pending[callID]
	if ok {
		delete(a.pending, callID)
	}
	a.mu.Unlock()
	if ok {
		ch <- approved
	}
}

func needsApproval(name string) bool {
	switch name {
	case "run_command", "send_keys", "delete_host", "disconnect", "update_host":
		return true
	}
	return false
}

func (a *Agent) waitApproval(ctx context.Context, callID string) (bool, error) {
	ch := make(chan bool, 1)
	a.mu.Lock()
	a.pending[callID] = ch
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		delete(a.pending, callID)
		a.mu.Unlock()
	}()
	select {
	case ok := <-ch:
		return ok, nil
	case <-ctx.Done():
		return false, ctx.Err()
	}
}

func (a *Agent) execTool(ctx context.Context, cfg AISettings, call llmToolCall) string {
	name := call.Function.Name
	raw := call.Function.Arguments
	if strings.TrimSpace(raw) == "" {
		raw = "{}"
	}
	emit := func(status, result string) {
		a.app.emit("agent:tool", agentToolEvent{CallID: call.ID, Name: name, Args: raw, Status: status, Result: result})
	}
	if needsApproval(name) && cfg.ApproveCommands {
		emit("pending_approval", "")
		ok, err := a.waitApproval(ctx, call.ID)
		if err != nil {
			emit("error", err.Error())
			return "error: " + err.Error()
		}
		if !ok {
			emit("rejected", "user rejected")
			return "user rejected"
		}
	}
	emit("running", "")
	result, err := a.dispatchTool(ctx, name, json.RawMessage(raw))
	if err != nil {
		emit("error", err.Error())
		return "error: " + err.Error()
	}
	emit("done", result)
	return result
}

func jsonResult(v interface{}) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", err
	}
	return string(raw), nil
}

func (a *Agent) dispatchTool(ctx context.Context, name string, args json.RawMessage) (string, error) {
	switch name {
	case "list_hosts":
		return jsonResult(a.app.store.ListHosts())
	case "add_host", "update_host":
		return a.hostTool(name, args)
	case "delete_host":
		var in struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		if in.ID == "" {
			return "", fmt.Errorf("id is required")
		}
		if err := a.app.store.DeleteHost(in.ID); err != nil {
			return "", err
		}
		return `{"deleted":true}`, nil
	case "connect":
		var in struct {
			HostID string `json:"host_id"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		id, err := a.app.sessions.Connect(in.HostID, 120, 32)
		if err != nil {
			return "", err
		}
		return jsonResult(map[string]string{"session_id": id})
	case "quick_connect":
		var in struct {
			Target   string `json:"target"`
			Password string `json:"password"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		id, err := a.app.sessions.QuickConnect(in.Target, in.Password, 120, 32)
		if err != nil {
			return "", err
		}
		return jsonResult(map[string]string{"session_id": id})
	case "list_sessions":
		return jsonResult(a.app.sessions.ListSessions())
	case "run_command":
		var in struct {
			SessionID  string `json:"session_id"`
			Command    string `json:"command"`
			TimeoutSec int    `json:"timeout_sec"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		res, err := a.app.sessions.runInSession(ctx, in.SessionID, in.Command, in.TimeoutSec)
		if err != nil {
			return "", err
		}
		return jsonResult(res)
	case "send_keys":
		var in struct {
			SessionID string `json:"session_id"`
			Keys      string `json:"keys"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		if err := a.app.sessions.sendKeys(in.SessionID, in.Keys); err != nil {
			return "", err
		}
		return `{"sent":true}`, nil
	case "read_screen":
		var in struct {
			SessionID string `json:"session_id"`
			Lines     int    `json:"lines"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		screen, err := a.app.sessions.readScreen(ctx, in.SessionID, in.Lines)
		if err != nil {
			return "", err
		}
		return screen, nil
	case "disconnect":
		var in struct {
			SessionID string `json:"session_id"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		a.app.sessions.Disconnect(in.SessionID)
		return `{"disconnected":true}`, nil
	case "focus_session":
		var in struct {
			SessionID string `json:"session_id"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		a.app.emit("ui:focus", in.SessionID)
		return `{"focused":true}`, nil
	case "set_theme":
		var in struct {
			ThemeID string `json:"theme_id"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		if err := a.app.setTheme(in.ThemeID); err != nil {
			return "", err
		}
		return jsonResult(map[string]string{"theme": in.ThemeID})
	case "update_settings":
		var in struct {
			Settings uiSettingsPatch `json:"settings"`
		}
		if err := json.Unmarshal(args, &in); err != nil {
			return "", err
		}
		st, err := a.app.applyUISettingsPatch(in.Settings)
		if err != nil {
			return "", err
		}
		return jsonResult(st)
	case "list_keys":
		keys, err := ListKeys()
		if err != nil {
			return "", err
		}
		return jsonResult(keys)
	case "list_themes":
		return jsonResult(a.app.listThemes())
	default:
		return "", fmt.Errorf("unknown tool %q", name)
	}
}

type hostFields struct {
	ID            *string `json:"id"`
	Name          *string `json:"name"`
	Group         *string `json:"group"`
	Address       *string `json:"address"`
	Port          *int    `json:"port"`
	User          *string `json:"user"`
	AuthMethod    *string `json:"auth_method"`
	KeyPath       *string `json:"key_path"`
	KeyPassphrase *string `json:"key_passphrase"`
	Password      *string `json:"password"`
	Color         *string `json:"color"`
	Notes         *string `json:"notes"`
}

func (a *Agent) hostTool(name string, args json.RawMessage) (string, error) {
	var f hostFields
	if err := json.Unmarshal(args, &f); err != nil {
		return "", err
	}
	if name == "add_host" {
		if f.Address == nil || *f.Address == "" {
			return "", fmt.Errorf("address is required")
		}
		h := Host{Port: 22, AuthMethod: "agent"}
		applyHostFields(&h, f)
		saved, err := a.app.store.SaveHost(h)
		if err != nil {
			return "", err
		}
		return jsonResult(saved)
	}
	if f.ID == nil || *f.ID == "" {
		return "", fmt.Errorf("id is required")
	}
	h, ok := a.app.store.HostByID(*f.ID)
	if !ok {
		return "", fmt.Errorf("host not found")
	}
	applyHostFields(&h, f)
	saved, err := a.app.store.SaveHost(h)
	if err != nil {
		return "", err
	}
	return jsonResult(saved)
}

func applyHostFields(h *Host, f hostFields) {
	if f.Name != nil {
		h.Name = *f.Name
	}
	if f.Group != nil {
		h.Group = *f.Group
	}
	if f.Address != nil {
		h.Address = *f.Address
	}
	if f.Port != nil {
		h.Port = *f.Port
	}
	if f.User != nil {
		h.User = *f.User
	}
	if f.AuthMethod != nil {
		h.AuthMethod = *f.AuthMethod
	}
	if f.KeyPath != nil {
		h.KeyPath = *f.KeyPath
	}
	if f.KeyPassphrase != nil {
		h.KeyPassphrase = *f.KeyPassphrase
	}
	if f.Password != nil {
		h.Password = *f.Password
	}
	if f.Color != nil {
		h.Color = *f.Color
	}
	if f.Notes != nil {
		h.Notes = *f.Notes
	}
}

type uiSettingsPatch struct {
	FontSize       *int     `json:"fontSize"`
	FontFamily     *string  `json:"fontFamily"`
	LineHeight     *float64 `json:"lineHeight"`
	CursorStyle    *string  `json:"cursorStyle"`
	UIScale        *float64 `json:"uiScale"`
	SidebarVisible *bool    `json:"sidebarVisible"`
	AgentVisible   *bool    `json:"agentVisible"`
	AgentSide      *string  `json:"agentSide"`
	ThemeID        *string  `json:"themeId"`
}
