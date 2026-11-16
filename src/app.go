package main
import (
	"context"
	"fmt"
	"os"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	store    *Store
	chats    *ChatStore
	sessions *SessionManager
	agent    *Agent
	emitFn   func(name string, args ...interface{})
}

func NewApp(store *Store, chats *ChatStore) *App {
	return &App{store: store, chats: chats}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.emitFn = func(name string, args ...interface{}) {
		runtime.EventsEmit(ctx, name, args...)
	}
	a.chats.setEmit(a.emitFn)
	a.sessions = NewSessionManager(a.store)
	a.sessions.emit = a.emitFn
	a.agent = NewAgent(a)
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

func (a *App) SaveSettings(st Settings) error {
	if err := a.store.SaveSettings(st); err != nil {
		return err
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
	return ChatDetail{ChatSummary: c.ChatSummary, Log: log}, nil
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
