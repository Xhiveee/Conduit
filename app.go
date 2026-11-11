package main

import (
	"context"
	"os"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type App struct {
	ctx      context.Context
	store    *Store
	sessions *SessionManager
	agent    *Agent
	emitFn   func(name string, args ...interface{})
}

func NewApp(store *Store) *App {
	return &App{store: store}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.emitFn = func(name string, args ...interface{}) {
		runtime.EventsEmit(ctx, name, args...)
	}
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
	return a.store.DeleteHost(id)
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

func (a *App) AgentSend(text, activeSessionID string) error {
	return a.agent.send(text, activeSessionID)
}

func (a *App) AgentStop() {
	a.agent.stop()
}

func (a *App) AgentReset() {
	a.agent.reset()
}

func (a *App) AgentApprove(callID string, approved bool) {
	a.agent.approve(callID, approved)
}

func (a *App) setTheme(id string) error {
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

var builtinThemeList = []ThemeInfo{
	{ID: "black", Name: "Black", Builtin: true},
	{ID: "dark", Name: "Dark", Builtin: true},
	{ID: "graphite", Name: "Graphite", Builtin: true},
	{ID: "nord", Name: "Nord", Builtin: true},
	{ID: "solarized-dark", Name: "Solarized Dark", Builtin: true},
	{ID: "light", Name: "Light", Builtin: true},
}

func (a *App) listThemes() []ThemeInfo {
	out := make([]ThemeInfo, len(builtinThemeList))
	copy(out, builtinThemeList)
	for _, t := range a.store.GetSettings().CustomThemes {
		out = append(out, ThemeInfo{ID: t.ID, Name: t.Name, Builtin: false})
	}
	return out
}
