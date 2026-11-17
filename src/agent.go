package main

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"
)

type agentMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type Agent struct {
	app     *App
	mu      sync.Mutex
	runs    map[string]context.CancelFunc
	pending map[string]chan bool
}

func NewAgent(app *App) *Agent {
	return &Agent{app: app, runs: make(map[string]context.CancelFunc), pending: make(map[string]chan bool)}
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
	newLLMTool("set_theme", "Switch the UI theme. Builtin ids: black, oled, dark, graphite, nord, solarized-dark, light.", `{"type":"object","properties":{"theme_id":{"type":"string"}},"required":["theme_id"]}`),
	newLLMTool("update_settings", "Update UI settings live: fontSize, fontFamily, lineHeight, cursorStyle, uiScale, sidebarVisible, agentVisible, agentSide, themeId, contextWindow.", `{"type":"object","properties":{"settings":{"type":"object","properties":{"fontSize":{"type":"integer"},"fontFamily":{"type":"string"},"lineHeight":{"type":"number"},"cursorStyle":{"type":"string"},"uiScale":{"type":"number"},"sidebarVisible":{"type":"boolean"},"agentVisible":{"type":"boolean"},"agentSide":{"type":"string","enum":["left","right"]},"themeId":{"type":"string"},"contextWindow":{"type":"integer"}}}},"required":["settings"]}`),
	newLLMTool("list_keys", "List discovered SSH keys (files in ~/.ssh and agent keys).", `{"type":"object","properties":{}}`),
	newLLMTool("list_themes", "List available themes with id, name and builtin flag.", `{"type":"object","properties":{}}`),
}

func (a *Agent) send(chatID, text, activeSessionID string) error {
	cs := a.app.chats
	if chatID == "" {
		s, err := cs.Create("")
		if err != nil {
			return err
		}
		chatID = s.ID
	}
	chat, ok := cs.Get(chatID)
	if !ok {
		return fmt.Errorf("chat not found")
	}
	a.mu.Lock()
	if _, busy := a.runs[chatID]; busy {
		a.mu.Unlock()
		return fmt.Errorf("agent is busy")
	}
	cfg := a.app.store.GetSettings().AI
	content := text + a.contextSuffix(chat, activeSessionID)
	userMsg := chatMessage{Role: "user", Content: content}
	messages := append(append([]chatMessage{}, chat.Messages...), userMsg)
	ctx, cancel := context.WithCancel(context.Background())
	a.runs[chatID] = cancel
	a.mu.Unlock()

	entry := ChatLogEntry{Kind: "user", Content: text, TS: time.Now().UnixMilli()}
	if _, err := cs.appendLog(chatID, entry); err != nil {
		a.mu.Lock()
		delete(a.runs, chatID)
		a.mu.Unlock()
		cancel()
		return err
	}
	if first := strings.SplitN(text, "\n", 2)[0]; chat.Title == "" {
		t := []rune(strings.TrimSpace(first))
		if len(t) > 60 {
			t = t[:60]
		}
		if title := string(t); title != "" {
			if err := cs.setTitleIfEmpty(chatID, title); err != nil {
				a.app.emit("agent:error", chatID, err.Error())
			}
		}
	}
	a.app.emit("agent:message", chatID, entry)
	cs.setBusy(chatID, true)
	a.app.emit("agent:busy", chatID, true)
	go a.run(ctx, chatID, cfg, messages)
	return nil
}

func (a *Agent) contextSuffix(chat *Chat, activeSessionID string) string {
	sessions := a.app.sessions.ListSessions()
	var b strings.Builder
	b.WriteString("\n\n[Context: ")
	if activeSessionID != "" {
		found := false
		for _, s := range sessions {
			if s.ID == activeSessionID {
				fmt.Fprintf(&b, "active session %s (%q)", s.ID, s.Title)
				found = true
				break
			}
		}
		if !found {
			fmt.Fprintf(&b, "active session %s", activeSessionID)
		}
	} else {
		b.WriteString("no active session")
	}
	if chat.HostID != "" {
		if h, ok := a.app.store.HostByID(chat.HostID); ok {
			name := h.Name
			if name == "" {
				name = h.User + "@" + h.Address
			}
			fmt.Fprintf(&b, "; this chat is attached to host %q (id %s). Work on that host; if no session for it is open, connect to it first.", name, h.ID)
		}
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

func (a *Agent) run(ctx context.Context, chatID string, cfg AISettings, messages []chatMessage) {
	defer func() {
		if r := recover(); r != nil {
			logf("error", "agent panic: %v", r)
			a.logNote(chatID, fmt.Sprintf("agent crashed: %v", r))
		}
		a.mu.Lock()
		delete(a.runs, chatID)
		a.mu.Unlock()
		a.app.chats.setBusy(chatID, false)
		a.app.emit("agent:busy", chatID, false)
	}()
	full := append([]chatMessage{{Role: "system", Content: agentSystemPrompt + instructionsSuffix(cfg.Instructions)}}, messages...)
	maxSteps := cfg.MaxSteps
	if maxSteps <= 0 {
		maxSteps = 30
	}
	for step := 0; step < maxSteps; step++ {
		a.app.emit("agent:thinking", chatID, true)
		msg, usage, err := chatCompletion(ctx, cfg, full, agentTools)
		a.app.emit("agent:thinking", chatID, false)
		if err != nil {
			if ctx.Err() == nil {
				logf("error", "agent request failed: %s", err.Error())
				a.logNote(chatID, "error: "+err.Error())
				a.app.emit("agent:error", chatID, err.Error())
			}
			return
		}
		if usage != nil {
			a.app.chats.addUsage(chatID, *usage)
			if s, ok := a.app.chats.GetSummary(chatID); ok {
				a.app.emit("agent:usage", chatID, s.Usage)
			}
		}
		full = append(full, *msg)
		if len(msg.ToolCalls) == 0 {
			if strings.TrimSpace(msg.Content) != "" {
				a.logEntry(chatID, ChatLogEntry{Kind: "assistant", Content: msg.Content})
			}
			break
		}
		if strings.TrimSpace(msg.Content) != "" {
			a.logEntry(chatID, ChatLogEntry{Kind: "assistant", Content: msg.Content})
		}
		for _, call := range msg.ToolCalls {
			result := a.execTool(ctx, chatID, call)
			full = append(full, chatMessage{
				Role:       "tool",
				ToolCallID: call.ID,
				Name:       call.Function.Name,
				Content:    result,
			})
		}
	}
	if err := a.app.chats.setMessages(chatID, full[1:]); err != nil {
		logf("error", "agent chat save failed: %s", err.Error())
		a.app.emit("agent:error", chatID, err.Error())
	}
}

func (a *Agent) logEntry(chatID string, e ChatLogEntry) {
	if _, err := a.app.chats.appendLog(chatID, e); err != nil {
		a.app.emit("agent:error", chatID, err.Error())
		return
	}
	if e.Kind == "assistant" {
		a.app.emit("agent:message", chatID, e)
	}
}

func (a *Agent) logNote(chatID, text string) {
	e := ChatLogEntry{Kind: "note", Content: text, TS: time.Now().UnixMilli()}
	if _, err := a.app.chats.appendLog(chatID, e); err == nil {
		a.app.emit("agent:message", chatID, e)
	}
}

func (a *Agent) logTool(chatID string, e ChatLogEntry) {
	if _, err := a.app.chats.appendLog(chatID, e); err != nil {
		a.app.emit("agent:error", chatID, err.Error())
		return
	}
	a.app.emit("agent:tool", chatID, e)
}

func (a *Agent) updateTool(chatID, callID, status, result string) {
	e := ChatLogEntry{Kind: "tool", CallID: callID, Status: status, Result: result, TS: time.Now().UnixMilli()}
	if nameArgs, ok := a.app.chats.Get(chatID); ok {
		for i := len(nameArgs.Log) - 1; i >= 0; i-- {
			if nameArgs.Log[i].Kind == "tool" && nameArgs.Log[i].CallID == callID {
				e.Name = nameArgs.Log[i].Name
				e.Args = nameArgs.Log[i].Args
				break
			}
		}
	}
	if err := a.app.chats.updateTool(chatID, callID, status, result); err != nil {
		a.app.emit("agent:error", chatID, err.Error())
	}
	a.app.emit("agent:tool", chatID, e)
}

func instructionsSuffix(inst string) string {
	if strings.TrimSpace(inst) == "" {
		return ""
	}
	return "\n\nAdditional instructions from the user:\n" + inst
}

func (a *Agent) stop(chatID string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if cancel, ok := a.runs[chatID]; ok {
		cancel()
	}
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

func (a *Agent) approveAll() {
	a.mu.Lock()
	chans := make([]chan bool, 0, len(a.pending))
	for _, ch := range a.pending {
		chans = append(chans, ch)
	}
	a.mu.Unlock()
	for _, ch := range chans {
		select {
		case ch <- true:
		default:
		}
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

func (a *Agent) execTool(ctx context.Context, chatID string, call llmToolCall) string {
	name := call.Function.Name
	raw := call.Function.Arguments
	if strings.TrimSpace(raw) == "" {
		raw = "{}"
	}
	toolEntry := ChatLogEntry{Kind: "tool", CallID: call.ID, Name: name, Args: raw, TS: time.Now().UnixMilli()}
	if needsApproval(name) && a.app.store.GetSettings().AI.ApproveCommands {
		toolEntry.Status = "pending_approval"
		a.logTool(chatID, toolEntry)
		ok, err := a.waitApproval(ctx, call.ID)
		if err != nil {
			a.updateTool(chatID, call.ID, "error", err.Error())
			return "error: " + err.Error()
		}
		if !ok {
			a.updateTool(chatID, call.ID, "rejected", "user rejected")
			return "user rejected"
		}
		a.updateTool(chatID, call.ID, "running", "")
	} else {
		toolEntry.Status = "running"
		a.logTool(chatID, toolEntry)
	}
	result, err := a.dispatchTool(ctx, name, json.RawMessage(raw))
	if err != nil {
		a.updateTool(chatID, call.ID, "error", err.Error())
		return "error: " + err.Error()
	}
	a.updateTool(chatID, call.ID, "done", result)
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
		if err := a.app.DeleteHost(in.ID); err != nil {
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
	ContextWindow  *int     `json:"contextWindow"`
}
