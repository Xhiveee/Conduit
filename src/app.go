package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	goruntime "runtime"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	store    *Store
	chats    *ChatStore
	sessions *SessionManager
	agent    *Agent
	emitFn   func(name string, args ...interface{})
	version  string
	logPath  string
}

func NewApp(store *Store, chats *ChatStore, version string) *App {
	return &App{store: store, chats: chats, version: version}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.logPath = initLog(dataDir())
	logf("info", "Conduit %s starting (%s/%s)", a.version, goruntime.GOOS, goruntime.GOARCH)
	logf("info", "data dir: %s", dataDir())
	logf("info", "log file: %s", a.logPath)
	a.emitFn = func(name string, args ...interface{}) {
		runtime.EventsEmit(ctx, name, args...)
	}
	a.chats.setEmit(a.emitFn)
	a.sessions = NewSessionManager(a.store)
	a.sessions.emit = a.emitFn
	a.agent = NewAgent(a)
	for _, w := range a.Warnings() {
		logf("warn", "%s", w)
	}
}

func (a *App) emit(name string, args ...interface{}) {
	if a.emitFn != nil {
		a.emitFn(name, args...)
		return
	}
	runtime.EventsEmit(a.ctx, name, args...)
}

func (a *App) ListHosts() []Host {
	return a.store.ListHosts()
}

func (a *App) SaveHost(h Host) (Host, error) {
	return a.store.SaveHost(h)
}

func (a *App) DeleteHost(id string) error {
	if err := a.store.DeleteHost(id); err != nil {
		return err
	}
	a.chats.DetachHost(id)
	return nil
}

func (a *App) GetSettings() Settings {
	return a.store.GetSettings()
}

func (a *App) Warnings() []string {
	out := a.store.Warnings()
	return append(out, a.chats.Warnings()...)
}

type AppInfo struct {
	Version  string `json:"version"`
	DataDir  string `json:"dataDir"`
	LogPath  string `json:"logPath"`
	Platform string `json:"platform"`
}

func (a *App) GetAppInfo() AppInfo {
	dir := dataDir()
	return AppInfo{
		Version:  a.version,
		DataDir:  dir,
		LogPath:  logPathFor(dir),
		Platform: goruntime.GOOS + "/" + goruntime.GOARCH,
	}
}

func (a *App) OpenDataFolder() {
	openInExplorer(dataDir())
}

func (a *App) OpenLogsFolder() {
	openInExplorer(logDirFor(dataDir()))
}

func openInExplorer(dir string) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		logf("error", "could not create folder %s: %v", dir, err)
		return
	}
	// explorer.exe hands the path to an existing window and exits, so Start must not be waited on
	_ = exec.Command("explorer.exe", dir).Start()
}

func (a *App) Diagnostics() string {
	dir := dataDir()
	log := a.logPath
	if log == "" {
		log = logPathFor(dir)
	}
	st := a.store.GetSettings()
	lang := st.Language
	if lang == "" {
		lang = "auto"
	}
	var b strings.Builder
	fmt.Fprintf(&b, "Conduit %s\n", a.version)
	fmt.Fprintf(&b, "Platform: %s/%s\n", goruntime.GOOS, goruntime.GOARCH)
	fmt.Fprintf(&b, "Data dir: %s\n", dir)
	fmt.Fprintf(&b, "Log file: %s\n", log)
	if info, err := os.Stat(log); err == nil {
		fmt.Fprintf(&b, "Log size: %d bytes\n", info.Size())
	}
	fmt.Fprintf(&b, "Theme: %s\n", st.ThemeID)
	fmt.Fprintf(&b, "Language: %s\n", lang)
	fmt.Fprintf(&b, "Font: %s %dpx\n", st.FontFamily, st.FontSize)
	fmt.Fprintf(&b, "UI scale: %.2f\n", st.UIScale)
	fmt.Fprintf(&b, "Command approvals: %v\n", st.AI.ApproveCommands)
	warnings := a.Warnings()
	if len(warnings) == 0 {
		b.WriteString("Warnings: none\n")
		return b.String()
	}
	b.WriteString("Warnings:\n")
	for i, w := range warnings {
		if i == 5 {
			fmt.Fprintf(&b, "  (+%d more)\n", len(warnings)-5)
			break
		}
		fmt.Fprintf(&b, "  - %s\n", w)
	}
	return b.String()
}

func (a *App) SaveSettings(st Settings) error {
	if err := a.store.SaveSettings(st); err != nil {
		logf("error", "settings save failed: %v", err)
		return err
	}
	if a.agent != nil && !st.AI.ApproveCommands {
		a.agent.approveAll()
	}
	a.emit("settings:changed", st)
	return nil
}

func (a *App) ImportSSHConfig() ([]Host, error) {
	path := sshConfigPath()
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, err
	}
	return a.store.ImportSSHConfig(f, home)
}

func (a *App) ListKeys() ([]KeyInfo, error) {
	return ListKeys()
}

func (a *App) Connect(hostID string, cols, rows int) (string, error) {
	return a.sessions.Connect(hostID, cols, rows)
}

func (a *App) QuickConnect(target, password string, cols, rows int) (string, error) {
	return a.sessions.QuickConnect(target, password, cols, rows)
}

func (a *App) ConnectWithSecret(hostID, secret string, save bool, cols, rows int) (string, error) {
	return a.sessions.ConnectWithSecret(hostID, secret, save, cols, rows)
}

func (a *App) Write(id, data string) error {
	return a.sessions.Write(id, data)
}

func (a *App) Resize(id string, cols, rows int) error {
	return a.sessions.Resize(id, cols, rows)
}

func (a *App) Disconnect(id string) {
	a.sessions.Disconnect(id)
}

func (a *App) ScreenReply(requestID, text string) {
	a.sessions.screenReply(requestID, text)
}

func (a *App) ListSessions() []SessionInfo {
	return a.sessions.ListSessions()
}

func (a *App) ListChats() []ChatSummary {
	return a.chats.List()
}

func (a *App) GetChat(id string) (ChatDetail, error) {
	c, ok := a.chats.Get(id)
	if !ok {
		return ChatDetail{}, fmt.Errorf("chat not found")
	}
	log := c.Log
	if log == nil {
		log = []ChatLogEntry{}
	}
	const maxLoadedLogEntries = 800
	truncated := len(log) > maxLoadedLogEntries
	if truncated {
		log = log[len(log)-maxLoadedLogEntries:]
	}
	return ChatDetail{ChatSummary: c.ChatSummary, Log: log, Truncated: truncated}, nil
}

func (a *App) CreateChat(hostID string) (ChatSummary, error) {
	return a.chats.Create(hostID)
}

func (a *App) RenameChat(id, title string) (ChatSummary, error) {
	return a.chats.Rename(id, title)
}

func (a *App) SetChatGroup(id, group string) (ChatSummary, error) {
	return a.chats.SetGroup(id, group)
}

func (a *App) AttachChat(id, hostID string) (ChatSummary, error) {
	return a.chats.Attach(id, hostID)
}

func (a *App) ArchiveChat(id string, archived bool) (ChatSummary, error) {
	return a.chats.Archive(id, archived)
}

func (a *App) DeleteChat(id string) error {
	a.agent.stop(id)
	return a.chats.Delete(id)
}

func (a *App) AgentSend(chatID, text, activeSessionID string) error {
	return a.agent.send(chatID, text, activeSessionID)
}

func (a *App) AgentStop(chatID string) {
	a.agent.stop(chatID)
}

func (a *App) AgentApprove(callID string, approved bool) {
	a.agent.approve(callID, approved)
}

func (a *App) setTheme(id string) error {
	if !builtinThemeIDs[id] {
		return fmt.Errorf("unknown theme %q", id)
	}
	st := a.store.GetSettings()
	st.ThemeID = id
	if err := a.store.SaveSettings(st); err != nil {
		logf("error", "theme save failed: %v", err)
		return err
	}
	a.emit("settings:changed", st)
	return nil
}

func (a *App) applyUISettingsPatch(p uiSettingsPatch) (Settings, error) {
	st := a.store.GetSettings()
	if p.FontSize != nil {
		st.FontSize = *p.FontSize
	}
	if p.FontFamily != nil {
		st.FontFamily = *p.FontFamily
	}
	if p.LineHeight != nil {
		st.LineHeight = *p.LineHeight
	}
	if p.CursorStyle != nil {
		st.CursorStyle = *p.CursorStyle
	}
	if p.UIScale != nil {
		st.UIScale = *p.UIScale
	}
	if p.SidebarVisible != nil {
		st.SidebarVisible = *p.SidebarVisible
	}
	if p.AgentVisible != nil {
		st.AgentVisible = *p.AgentVisible
	}
	if p.AgentSide != nil {
		st.AgentSide = *p.AgentSide
	}
	if p.ThemeID != nil {
		st.ThemeID = *p.ThemeID
	}
	if p.ContextWindow != nil {
		st.AI.ContextWindow = *p.ContextWindow
	}
	if err := a.store.SaveSettings(st); err != nil {
		logf("error", "ui settings save failed: %v", err)
		return st, err
	}
	a.emit("settings:changed", st)
	return st, nil
}

type ThemeInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Builtin bool   `json:"builtin"`
}

var builtinThemeIDs = map[string]bool{
	"black": true, "oled": true, "dark": true, "graphite": true,
	"nord": true, "solarized-dark": true, "light": true,
}

var builtinThemeList = []ThemeInfo{
	{ID: "black", Name: "Black", Builtin: true},
	{ID: "oled", Name: "Pure Black", Builtin: true},
	{ID: "dark", Name: "Dark", Builtin: true},
	{ID: "graphite", Name: "Graphite", Builtin: true},
	{ID: "nord", Name: "Nord", Builtin: true},
	{ID: "solarized-dark", Name: "Solarized Dark", Builtin: true},
	{ID: "light", Name: "Light", Builtin: true},
}

func (a *App) listThemes() []ThemeInfo {
	out := make([]ThemeInfo, len(builtinThemeList))
	copy(out, builtinThemeList)
	return out
}
